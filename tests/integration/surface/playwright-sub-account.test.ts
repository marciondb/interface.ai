import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixtureSessionProvider } from '../../../src/diplomat/session/fixture-login';
import { createPlaywrightDriver, type PlaywrightTestDriver } from '../../../src/diplomat/surface/playwright-driver';
import type { SurfaceAction } from '../../../src/models/action';
import type { HumanAction } from '../../../src/models/intervention';
import type { Observation, ObservationNode } from '../../../src/models/observation';
import { startFixture, type FixtureHandle } from '../../support/fixture';

function refOf(observation: Observation, match: (node: ObservationNode) => boolean): string {
  const ref = observation.nodes.find((node) => node.ref !== undefined && match(node))?.ref;
  if (ref === undefined) throw new Error('element not in the observation');
  return ref;
}

function text(observation: Observation): string {
  return observation.nodes.map((node) => node.name).join('\n');
}

// The write flow screen by screen through the driver: its native confirm() and the value
// displayed next to its label on the confirmation screen.
describe('Playwright driver on the sub-account flow', { timeout: 30_000 }, () => {
  let fixture: FixtureHandle | undefined;
  let driver: PlaywrightTestDriver | undefined;

  beforeAll(async () => {
    fixture = await startFixture();
    const session = await createFixtureSessionProvider({ username: 'operator', password: 'training' }).establish(`${fixture.baseUrl}/`);
    driver = createPlaywrightDriver({ exposePageForTests: true });
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

  function content() {
    const frame = surface().page().frame({ name: 'content' });
    if (frame === null) throw new Error('no content frame');
    return frame;
  }

  async function act(match: (node: ObservationNode) => boolean, action: (ref: string) => SurfaceAction): Promise<void> {
    const ref = refOf(await surface().observe(), match);
    expect(await surface().perform(action(ref))).toMatchObject({ status: 'done' });
  }

  const click = (ref: string): SurfaceAction => ({ kind: 'click', ref });

  it('fills the form and reaches the review', async () => {
    await content().goto(`${fixture?.baseUrl ?? ''}/member/detail?memberId=10001`);
    await act((node) => node.role === 'button' && node.name === 'Open Sub-Account', click);
    await act((node) => node.role === 'combobox' && node.label === 'Account Type', (ref) => ({ kind: 'select', ref, option: 'Money Market' }));
    await act((node) => node.role === 'textbox' && node.label === 'Nickname', (ref) => ({ kind: 'fill', ref, value: 'Rainy Day' }));
    await act((node) => node.role === 'textbox' && node.label === '$', (ref) => ({ kind: 'fill', ref, value: '250.00' }));
    await act((node) => node.role === 'button' && node.name === 'Continue', click);

    expect(text(await surface().observe())).toContain('Review Sub-Account Request');
  });

  it('refuses the confirm() dialog under automation and shows it in the next observation', async () => {
    await act((node) => node.role === 'button' && node.name === 'Confirm', click);

    const observation = await surface().observe();
    expect(observation.dialog).toEqual({ type: 'confirm', message: 'Submit this sub-account request?' });
    expect(text(observation)).toContain('Review Sub-Account Request');
  });

  it('applies the answer of the human in control, then describes and locates the new account number by its label', async () => {
    const actions: HumanAction[] = [];
    surface().startHumanCapture({ onAction: (action) => actions.push(action), onDialog: () => Promise.resolve('accept') });
    await content().click('input[value="Confirm"]');
    await content().waitForURL(/\/member\/subacct\/confirm$/);
    surface().stopHumanCapture();

    const opened = await surface().observe();
    expect(text(opened)).toContain('Sub-Account Opened');
    expect(actions.map((action) => action.kind)).toEqual(['click', 'navigation']);
    const number = refOf(opened, (node) => node.role === 'cell' && node.name === '10001MMRAIN025000');
    expect(await surface().inspect(number)).toMatchObject({ attributes: {}, label: 'New Account Number:' });

    const resolution = await surface().resolve({ frame: 'content', candidates: [{ strategy: 'label', text: 'New Account Number:' }] });
    expect(resolution).toMatchObject({ status: 'resolved', strategy: 'label', counts: [1] });
    if (resolution.status !== 'resolved') return;
    expect(await surface().perform({ kind: 'read', ref: resolution.ref })).toMatchObject({
      status: 'done',
      value: '10001MMRAIN025000',
    });
  });
});
