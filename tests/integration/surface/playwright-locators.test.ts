import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightDriver, type PlaywrightTestDriver } from '../../../src/diplomat/surface/playwright-driver';
import type { Candidate, TargetSpec } from '../../../src/models/capability';
import type { HumanAction } from '../../../src/models/intervention';
import type { Resolution } from '../../../src/models/resolution';
import { serveStatic, type StaticSite } from './static-site';

const FORM = `
  <label for="first">First name</label><input id="first">
  <span id="last-label">Last name</span><input id="last" aria-labelledby="last-label">
  <input id="nick" aria-label="Nickname">
  <label for="phone-1">Phone</label><input id="phone-1">
  <label for="phone-2">Phone</label><input id="phone-2">
  <table>
    <tr><td>Member ID:</td><td><input id="member"></td></tr>
    <tr><td>Balance</td><td>1,234.00</td></tr>
    <tr><td>Phone</td><td><input id="table-phone"></td></tr>
  </table>
  <button id="save" title="Save the member">Save</button>
`;

function resolvedRef(resolution: Resolution): string {
  if (resolution.status !== 'resolved') throw new Error(`unresolved: ${JSON.stringify(resolution.counts)}`);
  return resolution.ref;
}

describe('Playwright locator strategies', { timeout: 30_000 }, () => {
  let site: StaticSite | undefined;
  let driver: PlaywrightTestDriver | undefined;

  beforeAll(async () => {
    site = await serveStatic({ '/': FORM });
    driver = createPlaywrightDriver({ exposePageForTests: true });
    await driver.open(`${site.baseUrl}/`, []);
  }, 30_000);

  afterAll(async () => {
    await driver?.close();
    await site?.stop();
  });

  function surface(): PlaywrightTestDriver {
    if (driver === undefined) throw new Error('driver not started');
    return driver;
  }

  function resolve(...candidates: Candidate[]): Promise<Resolution> {
    const target: TargetSpec = { candidates };
    return surface().resolve(target);
  }

  async function idOf(resolution: Resolution): Promise<string | undefined> {
    return (await surface().inspect(resolvedRef(resolution))).attributes.id;
  }

  it('finds a label by its association first: <label for>, aria-labelledby and aria-label', async () => {
    expect(await idOf(await resolve({ strategy: 'label', text: 'First name' }))).toBe('first');
    expect(await idOf(await resolve({ strategy: 'label', text: 'Last name' }))).toBe('last');
    expect(await idOf(await resolve({ strategy: 'label', text: 'Nickname' }))).toBe('nick');
    expect(await resolve({ strategy: 'label', text: 'First' })).toEqual({ status: 'unresolved', counts: [0] });
  });

  it('falls back to the adjacent table cell only when no element is associated with the label', async () => {
    const member = await resolve({ strategy: 'label', text: 'Member ID:' });
    expect(member).toMatchObject({ status: 'resolved', counts: [1] });
    expect(await idOf(member)).toBe('member');

    const balance = await resolve({ strategy: 'label', text: 'Balance' });
    expect(await surface().perform({ kind: 'read', ref: resolvedRef(balance) })).toEqual({
      status: 'done',
      value: '1,234.00',
      navigations: [],
    });

    // Two inputs are labelled Phone: ambiguous, even though the table has one Phone cell.
    expect(await resolve({ strategy: 'label', text: 'Phone' })).toEqual({ status: 'unresolved', counts: [2] });
  });

  it('describes a control by its label as inspect, describe and the human capture all name it', async () => {
    const ref = resolvedRef(await resolve({ strategy: 'attribute', name: 'id', value: 'first' }));
    expect(await surface().inspect(ref)).toEqual({ attributes: { id: 'first' }, label: 'First name' });
    expect(await surface().describe(ref)).toMatchObject({ role: 'textbox', name: 'First name' });

    const member = resolvedRef(await resolve({ strategy: 'attribute', name: 'id', value: 'member' }));
    expect(await surface().inspect(member)).toEqual({ attributes: { id: 'member' }, label: 'Member ID:' });

    const actions: HumanAction[] = [];
    surface().startHumanCapture({ onAction: (action) => actions.push(action), onDialog: () => Promise.resolve('dismiss') });
    await surface().page().fill('#first', 'Ada');
    await surface().page().click('#save');
    await expect.poll(() => actions.length).toBe(2);
    surface().stopHumanCapture();

    expect(actions.map((action) => (action.kind === 'input' || action.kind === 'click' ? action.target : undefined))).toEqual([
      { frame: null, tag: 'input', role: 'textbox', name: 'First name', id: 'first' },
      { frame: null, tag: 'button', role: 'button', name: 'Save', id: 'save' },
    ]);
    const save = resolvedRef(await resolve({ strategy: 'attribute', name: 'id', value: 'save' }));
    expect(await surface().describe(save)).toMatchObject({ role: 'button', name: 'Save', texts: ['Save', 'Save the member'] });
  });

  it('rejects a role Playwright does not know instead of counting it as no match', async () => {
    const misspelt = resolve({ strategy: 'role', role: 'buton', name: 'Save' });
    await expect(misspelt).rejects.toMatchObject({ name: 'SurfaceError', code: 'invalid_candidate' });
    await expect(misspelt).rejects.toThrow('role "buton" is not an ARIA role');
    await expect(
      resolve({ strategy: 'table_cell', row: { column: 'A', equals: 'b' }, column: 'C', role: 'textfield' }),
    ).rejects.toMatchObject({ code: 'invalid_candidate' });
    expect(await resolve({ strategy: 'role', role: 'button', name: 'Save' })).toMatchObject({ status: 'resolved' });
  });
});
