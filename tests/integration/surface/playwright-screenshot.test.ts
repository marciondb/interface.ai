import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type Locator } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightDriver, type PlaywrightTestDriver } from '../../../src/diplomat/surface/playwright-driver';
import { maskLocators } from '../../../src/diplomat/surface/screenshot';
import { serveStatic, type StaticSite } from './static-site';

// Generated per run, so no literal sensitive-looking value lives in the repository.
const TOP_SECRET = `acct-${randomUUID().slice(0, 8)}`;
const FRAME_SECRET = `bal-${randomUUID().slice(0, 8)}`;
const FIELD_SECRET = `ssn-${randomUUID().slice(0, 8)}`;

const STYLE = '<style>body { margin: 0; background: #fff; } p, div, input { height: 40px; margin: 8px; }</style>';

type Rgb = readonly [number, number, number];

describe('Playwright driver screenshots', { timeout: 30_000 }, () => {
  let site: StaticSite | undefined;
  let driver: PlaywrightTestDriver | undefined;
  let decoder: Browser | undefined;

  beforeAll(async () => {
    site = await serveStatic({
      '/': `${STYLE}<p id="top">Account ${TOP_SECRET}</p><p id="plain">Nothing to hide</p>
        <input id="field" value="${FIELD_SECRET}"><iframe name="content" src="/inner" width="600" height="200"></iframe>`,
      '/inner': `${STYLE}<div id="inner">Balance <b>${FRAME_SECRET}</b></div><input id="typed">`,
    });
    driver = createPlaywrightDriver({ exposePageForTests: true });
    await driver.open(`${site.baseUrl}/`, []);
    await driver.observe();
    decoder = await chromium.launch();
  }, 30_000);

  afterAll(async () => {
    await driver?.close();
    await decoder?.close();
    await site?.stop();
  });

  function surface(): PlaywrightTestDriver {
    if (driver === undefined) throw new Error('driver not started');
    return driver;
  }

  function content() {
    const frame = surface().page().frame({ name: 'content' });
    if (frame === null) throw new Error('no content frame');
    return frame;
  }

  // The PNG's pixel at the centre of each element, decoded by a browser.
  async function centres(png: Uint8Array, elements: readonly Locator[]): Promise<Rgb[]> {
    const points: { x: number; y: number }[] = [];
    for (const element of elements) {
      const box = await element.boundingBox();
      if (box === null) throw new Error('element has no box');
      points.push({ x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) });
    }
    if (decoder === undefined) throw new Error('decoder not started');
    const page = await decoder.newPage();
    try {
      const input = JSON.stringify({ data: Buffer.from(png).toString('base64'), points });
      return await page.evaluate<Rgb[]>(`(async ({ data, points }) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + data;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return points.map(({ x, y }) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3)));
      })(${input})`);
    } finally {
      await page.close();
    }
  }

  it('covers text and field values that contain a mask text, in the page and in its frames', async () => {
    await content().fill('#typed', `typed ${FIELD_SECRET} here`);
    const page = surface().page();
    const masked = [page.locator('#top'), page.locator('#field'), content().locator('#inner b'), content().locator('#typed')];

    const png = await surface().screenshot({ maskTexts: [TOP_SECRET, FRAME_SECRET, FIELD_SECRET, ''] });

    const [plain, ...covered] = await centres(png, [page.locator('#plain'), ...masked]);
    for (const pixel of covered) expect(pixel).toEqual([255, 0, 255]);
    expect(plain).toEqual([255, 255, 255]);
  });

  it('matches mask texts case-sensitively, and masks nothing without them', async () => {
    const page = surface().page();

    expect(await maskLocators(page, [TOP_SECRET.toUpperCase()]).then(countAll)).toBe(0);
    expect(await maskLocators(page, [TOP_SECRET]).then(countAll)).toBeGreaterThan(0);
    expect(await maskLocators(page, ['', ''])).toEqual([]);

    const [top] = await centres(await surface().screenshot(), [page.locator('#top')]);
    expect(top).not.toEqual([255, 0, 255]);
  });
});

async function countAll(locators: readonly Locator[]): Promise<number> {
  let total = 0;
  for (const locator of locators) total += await locator.count();
  return total;
}
