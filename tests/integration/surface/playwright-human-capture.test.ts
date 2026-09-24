import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixtureSessionProvider } from '../../../src/diplomat/session/fixture-login';
import { createPlaywrightDriver, type PlaywrightDriver } from '../../../src/diplomat/surface/playwright-driver';
import type { HumanAction } from '../../../src/models/intervention';
import type { Dialog } from '../../../src/models/observation';
import { startFixture, type FixtureHandle } from '../../support/fixture';

const PASSWORD = 'training';

describe('Playwright human capture against the fixture', { timeout: 30_000 }, () => {
  let fixture: FixtureHandle | undefined;
  let driver: PlaywrightDriver | undefined;

  beforeAll(async () => {
    fixture = await startFixture();
    const session = await createFixtureSessionProvider({ username: 'operator', password: PASSWORD }).establish(`${fixture.baseUrl}/`);
    driver = createPlaywrightDriver();
    await driver.open(`${fixture.baseUrl}/`, session);
  }, 30_000);

  afterAll(async () => {
    await driver?.close();
    await fixture?.stop();
  });

  function surface(): PlaywrightDriver {
    if (driver === undefined) throw new Error('driver not started');
    return driver;
  }

  function content() {
    const frame = surface().page().frame({ name: 'content' });
    if (frame === null) throw new Error('no content frame');
    return frame;
  }

  it('reports human clicks, masked field changes and navigations only while capturing', async () => {
    const actions: HumanAction[] = [];
    const listener = { onAction: (action: HumanAction) => actions.push(action), onDialog: () => Promise.resolve('dismiss' as const) };

    const shell = await surface().observe();
    const lookup = shell.nodes.find((node) => node.role === 'link' && node.name === 'Member Lookup');
    await surface().perform({ kind: 'click', ref: lookup?.ref ?? '' });
    await content().waitForSelector('text=Member ID:');

    surface().startHumanCapture(listener);
    await content().fill('input[name="ctl00$ContentPlaceHolder1$txtMemberId"]', '10001');
    await content().click('input[value="Search"]');
    await expect.poll(() => actions.some((action) => action.kind === 'navigation')).toBe(true);
    surface().stopHumanCapture();
    await surface().page().click('text=Member Lookup');
    await content().waitForURL(/\/member\/search$/);

    expect(actions.map((action) => action.kind)).toEqual(['input', 'click', 'navigation']);
    expect(actions[0]).toMatchObject({
      kind: 'input',
      value: '[redacted]',
      target: { frame: 'content', tag: 'input', role: 'textbox', nameAttr: 'ctl00$ContentPlaceHolder1$txtMemberId' },
    });
    expect(actions[1]).toMatchObject({ kind: 'click', target: { frame: 'content', tag: 'input', role: 'button', name: 'Search' } });
    expect(actions[2]).toMatchObject({ kind: 'navigation', frame: 'content', url: `${fixture?.baseUrl ?? ''}/member/results` });
    expect(JSON.stringify(actions)).not.toContain('10001');
  });

  it('dismisses a dialog under automation and shows it in the next observation', async () => {
    const accepted = await content().evaluate('confirm("Submit this request?")');

    expect(accepted).toBe(false);
    const observation = await surface().observe();
    expect(observation.dialog).toEqual({ type: 'confirm', message: 'Submit this request?' });
    expect((await surface().observe()).dialog).toBeNull();
  });

  it('asks the listener about a dialog while capturing and applies the answer', async () => {
    const asked: Dialog[] = [];
    const actions: HumanAction[] = [];
    surface().startHumanCapture({
      onAction: (action) => actions.push(action),
      onDialog: (dialog) => {
        asked.push(dialog);
        return Promise.resolve('accept');
      },
    });
    const accepted = await content().evaluate('confirm("Submit this request?")');
    surface().stopHumanCapture();

    expect(accepted).toBe(true);
    expect(asked).toEqual([{ type: 'confirm', message: 'Submit this request?' }]);
    expect((await surface().observe()).dialog).toBeNull();
  });

  it('calls back once when the window is closed', async () => {
    let calls = 0;
    surface().onClosed(() => (calls += 1));

    await surface().page().close();

    await expect.poll(() => calls).toBe(1);
  });
});
