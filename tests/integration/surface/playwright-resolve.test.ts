import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixtureSessionProvider } from '../../../src/diplomat/session/fixture-login';
import { createPlaywrightDriver } from '../../../src/diplomat/surface/playwright-driver';
import type { SurfaceDriver } from '../../../src/diplomat/surface/port';
import type { TargetSpec } from '../../../src/models/capability';
import type { Resolution } from '../../../src/models/resolution';
import { startFixture, type FixtureHandle } from '../../support/fixture';

function resolvedRef(resolution: Resolution): string {
  if (resolution.status !== 'resolved') throw new Error(`unresolved: ${JSON.stringify(resolution.counts)}`);
  return resolution.ref;
}

describe('Playwright target resolution against the fixture', { timeout: 30_000 }, () => {
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

  async function click(target: TargetSpec): Promise<void> {
    const outcome = await surface().perform({ kind: 'click', ref: resolvedRef(await surface().resolve(target)) });
    expect(outcome.status).toBe('done');
  }

  it('falls back from role to label for the unnamed Member ID input', async () => {
    await click({ candidates: [{ strategy: 'role', role: 'link', name: 'Member Lookup' }] });

    const resolution = await surface().resolve({
      frame: 'content',
      candidates: [
        { strategy: 'role', role: 'textbox', name: 'Member ID' },
        { strategy: 'label', text: 'Member ID:' },
      ],
    });

    expect(resolution).toMatchObject({ status: 'resolved', candidateIndex: 1, strategy: 'label', counts: [0, 1] });
    const ref = resolvedRef(resolution);
    await surface().perform({ kind: 'fill', ref: ref, value: '10002' });
    expect(await surface().perform({ kind: 'read', ref: ref })).toEqual({
      status: 'done',
      value: '10002',
      navigations: [],
    });
  });

  it('skips an ambiguous candidate and reads a cell by column headers (10002 Savings)', async () => {
    await click({ frame: 'content', candidates: [{ strategy: 'role', role: 'button', name: 'Search' }] });
    await click({ frame: 'content', candidates: [{ strategy: 'attribute', name: 'href', value: '/member/detail?memberId=10002' }] });

    const resolution = await surface().resolve({
      frame: 'content',
      candidates: [
        // Each action form on the detail page has a hidden memberId field.
        { strategy: 'attribute', name: 'name', value: 'memberId' },
        { strategy: 'table_cell', row: { column: 'Acct Type', equals: 'Savings' }, column: 'Balance' },
      ],
    });

    expect(resolution).toMatchObject({ status: 'resolved', candidateIndex: 1, strategy: 'table_cell' });
    expect(resolution.counts[0]).toBeGreaterThan(1);
    const read = await surface().perform({ kind: 'read', ref: resolvedRef(resolution) });
    expect(read).toMatchObject({ status: 'done', value: '3,100.55' });
  });

  it('describes where a link leads', async () => {
    const ref = resolvedRef(await surface().resolve({ frame: 'content', candidates: [{ strategy: 'text', text: 'New Search' }] }));

    expect(await surface().describe(ref)).toMatchObject({
      role: 'link',
      name: 'New Search',
      frameUrl: `${fixture?.baseUrl ?? ''}/member/detail?memberId=10002`,
      destination: `${fixture?.baseUrl ?? ''}/member/search`,
    });
  });

  it('reports every candidate count when nothing matches exactly once', async () => {
    const resolution = await surface().resolve({
      frame: 'content',
      candidates: [
        { strategy: 'role', role: 'button', name: 'Delete Everything' },
        { strategy: 'table_cell', row: { column: 'Acct Type', equals: 'Brokerage' }, column: 'Balance' },
        { strategy: 'text', text: 'Brokerage' },
      ],
    });

    expect(resolution).toEqual({ status: 'unresolved', counts: [0, 0, 0] });
    expect(await surface().resolve({ frame: 'missing', candidates: [{ strategy: 'text', text: 'Savings' }] })).toEqual({
      status: 'unresolved',
      counts: [0],
    });
  });
});
