import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { toObservation } from '../../adapters/aria-snapshot';
import { AriaSnapshotWireSchema } from '../../wire/in/aria-snapshot';
import { SurfaceError } from './errors';
import type { SurfaceDriver } from './port';

const LOAD_TIMEOUT_MS = 5_000;
const SNAPSHOT_TIMEOUT_MS = 5_000;
const ACTION_TIMEOUT_MS = 5_000;

export type PlaywrightDriverOptions = {
  readonly headless?: boolean;
};

type Surface = {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
};

async function launch(headless: boolean): Promise<Surface> {
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    return { browser, context, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export function createPlaywrightDriver(options: PlaywrightDriverOptions = {}): SurfaceDriver {
  const headless = options.headless ?? true;
  let surface: Surface | undefined;
  let refTargets: ReadonlyMap<string, string> = new Map();
  let observations = 0;

  function current(): Surface {
    if (surface === undefined) throw new SurfaceError('not_open', 'open() has not been called');
    return surface;
  }

  // Only checks the ref is known; that it belongs to the current observation is the controller's Ground step.
  function locate(page: Page, ref: string | null): Locator {
    const raw = ref === null ? undefined : refTargets.get(ref);
    if (raw === undefined) throw new SurfaceError('unknown_ref', `${ref ?? 'no target'} is not in the latest observation`);
    return page.locator(`aria-ref=${raw}`);
  }

  return {
    async open(url, session) {
      surface ??= await launch(headless);
      const origin = new URL(url).origin;
      await surface.context.addCookies(session.map((cookie) => ({ name: cookie.name, value: cookie.value, url: origin })));
      refTargets = new Map();
      await surface.page.goto(url, { waitUntil: 'load' });
    },

    async observe() {
      const { page } = current();
      refTargets = new Map();
      await page.waitForLoadState('domcontentloaded', { timeout: LOAD_TIMEOUT_MS });
      for (const frame of page.mainFrame().childFrames()) {
        await frame.waitForLoadState('domcontentloaded', { timeout: LOAD_TIMEOUT_MS });
      }
      const snapshot: unknown = await page.ariaSnapshotJSON({ mode: 'ai', timeout: SNAPSHOT_TIMEOUT_MS });
      const frames = page.mainFrame().childFrames().map((frame) => ({ name: frame.name(), url: frame.url() }));
      const wire = AriaSnapshotWireSchema.safeParse({
        url: page.url(),
        frames,
        nodes: Array.isArray(snapshot) ? snapshot : [snapshot],
      });
      if (!wire.success) throw new SurfaceError('snapshot_mismatch', 'the aria snapshot has an unexpected shape');

      const result = toObservation(wire.data, observations + 1);
      if (!result.ok) throw new SurfaceError('snapshot_mismatch', result.reason);
      observations += 1;
      refTargets = result.refTargets;
      return result.observation;
    },

    async perform(action) {
      const { page } = current();
      switch (action.verb) {
        case 'click':
          await locate(page, action.target).click({ timeout: ACTION_TIMEOUT_MS });
          return;
        case 'fill':
          if (action.argument === null) throw new SurfaceError('unsupported_action', 'fill needs an argument');
          await locate(page, action.target).fill(action.argument, { timeout: ACTION_TIMEOUT_MS });
          return;
        case 'select':
        case 'press':
        case 'navigate':
        case 'read':
        case 'finish':
        case 'request_help':
          throw new SurfaceError('unsupported_action', `${action.verb} is not implemented by the Playwright driver`);
        default: {
          const unhandled: never = action.verb;
          throw new SurfaceError('unsupported_action', String(unhandled));
        }
      }
    },

    async close() {
      const closing = surface;
      surface = undefined;
      refTargets = new Map();
      await closing?.browser.close();
    },
  };
}
