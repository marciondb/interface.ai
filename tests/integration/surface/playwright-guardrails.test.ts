import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createActionGateway } from '../../../src/diplomat/gateway/action-gateway';
import type { ActionGateway } from '../../../src/diplomat/gateway/port';
import { createFixtureSessionProvider } from '../../../src/diplomat/session/fixture-login';
import type { SessionCookie } from '../../../src/diplomat/session/port';
import { createPlaywrightDriver, type PlaywrightTestDriver } from '../../../src/diplomat/surface/playwright-driver';
import type { HumanAction } from '../../../src/models/intervention';
import type { Policy } from '../../../src/models/policy';
import { startFixture, type FixtureHandle } from '../../support/fixture';

// Controls a page could draw to hide a risky label from a name-only check.
const DISGUISED_CONTROLS = `
  <input type="image" id="image-input" alt="Confirm" src="data:,">
  <button id="image-button"><img alt="Confirm" src="data:,"></button>
  <span id="closing">Close Account</span><button id="labelled" aria-labelledby="closing">›</button>
  <button id="titled" title="Post Adjustment">›</button>
  <button id="plain">Continue</button>
`;

describe('Playwright driver guardrails against the fixture', { timeout: 30_000 }, () => {
  let fixture: FixtureHandle | undefined;
  let driver: PlaywrightTestDriver | undefined;
  let gateway: ActionGateway | undefined;
  let session: readonly SessionCookie[] = [];

  beforeAll(async () => {
    fixture = await startFixture();
    session = await createFixtureSessionProvider({ username: 'operator', password: 'training' }).establish(`${fixture.baseUrl}/`);
    driver = createPlaywrightDriver({ exposePageForTests: true });
    const policy: Policy = {
      allowedOrigins: [new URL(fixture.baseUrl).origin],
      allowedRoutes: ['/', '/welcome', '/member/*'],
      allowedActions: ['click', 'navigate', 'read'],
      risky: { routes: ['/member/danger/*'], controlText: ['Close Account', 'Post Adjustment', 'Confirm'] },
    };
    // Installs the navigation guard from the policy.
    gateway = createActionGateway({ driver, policy, controlOwner: () => 'automation' });
    await driver.open(`${fixture.baseUrl}/`, session);
  }, 30_000);

  afterAll(async () => {
    await driver?.close();
    await fixture?.stop();
  });

  function surface(): PlaywrightTestDriver {
    if (driver === undefined) throw new Error('driver not started');
    return driver;
  }

  function policed(): ActionGateway {
    if (gateway === undefined) throw new Error('gateway not created');
    return gateway;
  }

  function content() {
    const frame = surface().page().frame({ name: 'content' });
    if (frame === null) throw new Error('no content frame');
    return frame;
  }

  async function sessionAlive(): Promise<boolean> {
    await surface().open(`${fixture?.baseUrl ?? ''}/`, session);
    return (await surface().observe()).frames.every((frame) => !frame.url.includes('/login'));
  }

  it('looks for risky text in the alt, title and labelledby text of a control, not only its name', async () => {
    await content().evaluate(`document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(DISGUISED_CONTROLS)})`);

    for (const id of ['image-input', 'image-button', 'labelled', 'titled']) {
      const resolution = await surface().resolve({ frame: 'content', candidates: [{ strategy: 'attribute', name: 'id', value: id }] });
      if (resolution.status !== 'resolved') throw new Error(`${id} did not resolve`);
      const decision = await policed().check({ kind: 'click', ref: resolution.ref });
      expect(decision, id).toMatchObject({ decision: 'requires_human' });
    }
    const image = await surface().resolve({ frame: 'content', candidates: [{ strategy: 'attribute', name: 'id', value: 'image-input' }] });
    if (image.status !== 'resolved') throw new Error('image-input did not resolve');
    expect(await surface().describe(image.ref)).toMatchObject({ role: 'button', name: 'Confirm', texts: ['Confirm'] });
    const plain = await surface().resolve({ frame: 'content', candidates: [{ strategy: 'attribute', name: 'id', value: 'plain' }] });
    if (plain.status !== 'resolved') throw new Error('plain did not resolve');
    expect(await policed().check({ kind: 'click', ref: plain.ref })).toEqual({ decision: 'allow' });
  });

  it('aborts a frame navigation a page script starts outside the allowlist', async () => {
    const failed = surface().page().waitForEvent('requestfailed');
    await content().evaluate(`location.href = '/logout'`);

    expect((await failed).url()).toContain('/logout');
    expect(surface().frameUrls().some((url) => url.includes('/logout') || url.includes('/login'))).toBe(false);
    expect(await sessionAlive()).toBe(true);
  });

  it('closes popups', async () => {
    const popup = surface().page().context().waitForEvent('page');
    await content().evaluate(`window.open('/member/search')`);

    await (await popup).waitForEvent('close');
    expect(surface().page().context().pages()).toEqual([surface().page()]);
  });

  it('caps what page scripts can report as human actions during one capture', async () => {
    const actions: HumanAction[] = [];
    const listener = { onAction: (action: HumanAction) => actions.push(action), onDialog: () => Promise.resolve('dismiss' as const) };
    const flood = `Promise.all(Array.from({ length: 250 }, () => window.__cuHumanEvent({ kind: 'click', target: { tag: 'button' } })))`;

    surface().startHumanCapture(listener);
    await content().evaluate(flood);
    surface().stopHumanCapture();
    expect(actions).toHaveLength(200);

    surface().startHumanCapture(listener);
    await content().evaluate(`window.__cuHumanEvent({ kind: 'click', target: { tag: 'button' } })`);
    surface().stopHumanCapture();
    expect(actions).toHaveLength(201);
  });

  it('aborts a top-level navigation a page script starts outside the allowlist', async () => {
    const failed = surface().page().waitForEvent('requestfailed');
    await surface().page().evaluate(`location.href = '/logout'`);

    expect((await failed).url()).toContain('/logout');
    // The browser's error page, which the gateway's landing check rejects in turn.
    await expect.poll(() => surface().currentUrl()).toMatch(/^chrome-error:/);
    expect(await sessionAlive()).toBe(true);
  });
});
