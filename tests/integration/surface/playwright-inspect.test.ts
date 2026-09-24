import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixtureSessionProvider } from '../../../src/diplomat/session/fixture-login';
import { createPlaywrightDriver } from '../../../src/diplomat/surface/playwright-driver';
import type { SurfaceDriver } from '../../../src/diplomat/surface/port';
import type { Observation, ObservationNode } from '../../../src/models/observation';
import { startFixture, type FixtureHandle } from '../../support/fixture';

function refOf(observation: Observation, match: (node: ObservationNode) => boolean): string {
  const ref = observation.nodes.find((node) => node.ref !== undefined && match(node))?.ref;
  if (ref === undefined) throw new Error('element not in the observation');
  return ref;
}

describe('Playwright element descriptors against the fixture', { timeout: 30_000 }, () => {
  let fixture: FixtureHandle | undefined;
  let driver: SurfaceDriver | undefined;

  beforeAll(async () => {
    fixture = await startFixture();
    const session = await createFixtureSessionProvider({ username: 'operator', password: 'training' }).establish(
      `${fixture.baseUrl}/`,
    );
    driver = createPlaywrightDriver();
    await driver.open(`${fixture.baseUrl}/`, session);
  }, 30_000);

  afterAll(async () => {
    await driver?.close();
    await fixture?.stop();
  });

  function surface(): SurfaceDriver {
    if (driver === undefined) throw new Error('driver not started');
    return driver;
  }

  async function click(match: (node: ObservationNode) => boolean): Promise<void> {
    const ref = refOf(await surface().observe(), match);
    expect(await surface().perform({ kind: 'click', ref: ref })).toMatchObject({ status: 'done' });
  }

  it('describes the unnamed Member ID input by its adjacent label and ASP.NET attributes', async () => {
    await click((node) => node.role === 'link' && node.name === 'Member Lookup');

    const ref = refOf(await surface().observe(), (node) => node.role === 'textbox');

    expect(await surface().inspect(ref)).toEqual({
      attributes: { name: 'ctl00$ContentPlaceHolder1$txtMemberId', id: 'ctl00_ContentPlaceHolder1_txtMemberId' },
      label: 'Member ID:',
    });
  });

  it('describes a balance cell and a member link by their table columns and rows', async () => {
    const lookup = await surface().observe();
    await surface().perform({ kind: 'fill', ref: refOf(lookup, (node) => node.role === 'textbox'), value: '10002' });
    await click((node) => node.role === 'button' && node.name === 'Search');

    const results = await surface().observe();
    expect(await surface().inspect(refOf(results, (node) => node.role === 'link' && node.name === 'James Whitfield'))).toEqual({
      attributes: {},
      cell: { column: 'Name', row: { 'Member ID': '10002', Name: 'James Whitfield', Status: 'Active' } },
    });

    await click((node) => node.role === 'link' && node.name === 'James Whitfield');
    const detail = await surface().observe();

    expect(await surface().inspect(refOf(detail, (node) => node.role === 'cell' && node.name === '3,100.55'))).toEqual({
      attributes: {},
      label: '100022203',
      cell: { column: 'Balance', row: { 'Acct Type': 'Savings', 'Acct Number': '100022203', Balance: '3,100.55' } },
    });
  });
});
