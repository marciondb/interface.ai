import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExecutionResultSchema, type ExecutionResult } from '../../../src/models/execution-result';
import { evidenceText, readEvents as events } from '../../support/evidence';
import { startFixture, type FixtureHandle } from '../../support/fixture';
import { PASSWORD, referenceCapabilities, runReplay, STEP_TIMEOUT_MS, type HarnessOptions, type HarnessRun } from '../../support/replay-harness';

const MARIA = { memberId: '10001', accountType: 'Savings' };

function failure(result: ExecutionResult) {
  if (result.status !== 'failed') throw new Error(`expected failed, got ${JSON.stringify(result)}`);
  return result.failure;
}

describe('replay of member.read-account-balance@1 against the fixture', { timeout: 30_000 }, () => {
  let fixture: FixtureHandle | undefined;
  let capabilitiesDir = '';

  beforeAll(async () => {
    fixture = await startFixture();
    capabilitiesDir = await referenceCapabilities();
  }, 30_000);

  afterAll(async () => {
    await fixture?.stop();
  });

  function run(inputs: Record<string, string>, options?: HarnessOptions): Promise<HarnessRun> {
    if (fixture === undefined) throw new Error('fixture not started');
    return runReplay(fixture, inputs, { capabilitiesDir, ...options });
  }

  it('reads the savings balance of 10001', async () => {
    const { result } = await run(MARIA);

    expect(result).toMatchObject({
      status: 'succeeded',
      outputs: { balance: '4,812.37' },
      capability: { id: 'member.read-account-balance', version: '1.0.0' },
      recoveries: [],
      interventions: [],
    });
  });

  it('finds savings by column headers when it is not the first account (10002)', async () => {
    const replayRun = await run({ memberId: '10002', accountType: 'Savings' });

    expect(replayRun.result).toMatchObject({ status: 'succeeded', outputs: { balance: '3,100.55' } });
    const balanceTarget = (await events(replayRun)).find((event) => event.type === 'target_resolved' && event.stepId === 'read-balance');
    expect(balanceTarget).toMatchObject({ target: 'detail.balance', strategy: 'table_cell', counts: [1] });
  });

  it('returns member_not_found for 99999 without waiting for the step timeout', async () => {
    const started = Date.now();
    const { result } = await run({ memberId: '99999', accountType: 'Savings' });

    expect(result).toMatchObject({ status: 'business_outcome', outcome: 'member_not_found', details: { stepId: 'submit-search' } });
    expect(Date.now() - started).toBeLessThan(STEP_TIMEOUT_MS * 3);
  });

  it('returns member_restricted for 10009', async () => {
    const { result } = await run({ memberId: '10009', accountType: 'Savings' });

    expect(result).toMatchObject({ status: 'business_outcome', outcome: 'member_restricted', details: { stepId: 'submit-search' } });
  });

  it('rejects an invalid member id before touching the surface', async () => {
    const replayRun = await run({ memberId: 'abc', accountType: 'Savings' });

    expect(failure(replayRun.result)).toMatchObject({ stepId: 'inputs', code: 'invalid_input' });
    expect((await events(replayRun)).map((event) => event.type)).toEqual(['run_started', 'result']);
  });

  it('reports an unknown capability as artifact_unavailable', async () => {
    const { result } = await run(MARIA, { capability: 'member.does-not-exist' });

    expect(failure(result)).toMatchObject({ stepId: 'artifact', code: 'artifact_unavailable' });
  });

  it('retries a slow load after the step timeout', async () => {
    const { result } = await run(MARIA, { arm: { stepId: 'open-member-lookup', kind: 'slow_load' } });

    expect(result).toMatchObject({
      status: 'succeeded',
      outputs: { balance: '4,812.37' },
      recoveries: [{ stepId: 'open-member-lookup', condition: 'timeout', response: 'retry', attempt: 1 }],
    });
  });

  it('dismisses the maintenance interstitial with its declared recovery', async () => {
    const { result } = await run(MARIA, { arm: { stepId: 'open-member-lookup', kind: 'interstitial' } });

    expect(result).toMatchObject({
      status: 'succeeded',
      outputs: { balance: '4,812.37' },
      recoveries: [{ stepId: 'open-member-lookup', condition: 'interstitial', response: 'declared_recovery', attempt: 1 }],
    });
  });

  it('re-authenticates once and restarts after the session expires', async () => {
    const { result } = await run(MARIA, { arm: { stepId: 'submit-search', kind: 'session_expired' } });

    expect(result).toMatchObject({
      status: 'succeeded',
      outputs: { balance: '4,812.37' },
      recoveries: [{ stepId: 'submit-search', condition: 'session_expired', response: 'reauthenticate', attempt: 1 }],
    });
  });

  it('fails when the session expires a second time, without leaking the password', async () => {
    const replayRun = await run(MARIA, { arm: { stepId: 'submit-search', kind: 'session_expired', times: 2 } });

    expect(failure(replayRun.result)).toMatchObject({ stepId: 'submit-search', code: 'session_expired' });
    expect(await evidenceText(replayRun)).not.toContain(PASSWORD);
  });

  it('fails on a server error page', async () => {
    const { result } = await run(MARIA, { arm: { stepId: 'open-member-lookup', kind: 'server_error' } });

    expect(failure(result)).toMatchObject({ stepId: 'open-member-lookup', code: 'server_error' });
  });

  it('fails with target_not_found when the Search button is missing, with evidence', async () => {
    const replayRun = await run(MARIA, { arm: { stepId: 'open-member-lookup', kind: 'element_missing' } });
    const { result, evidenceRoot } = replayRun;

    const failed = failure(result);
    expect(failed).toMatchObject({ stepId: 'submit-search', code: 'target_not_found' });
    expect(failed.expected).toContain('lookup.search');
    expect(failed.observed).toContain('role button "Search" matched 0');
    expect(failed.observed).toContain('attribute id="ctl00_ContentPlaceHolder1_btnPrimary" matched 0');

    const runDir = join(evidenceRoot, result.runId);
    const lines = await events(replayRun);
    expect(lines.every((line) => line.runId === result.runId)).toBe(true);
    expect(lines.map((line) => line.seq)).toEqual(lines.map((_, index) => index + 1));
    const written = ExecutionResultSchema.parse(JSON.parse(await readFile(join(runDir, 'result.json'), 'utf8')));
    expect(written).toEqual(result);
    expect(failed.evidence).toMatch(/screenshots\/\d+-submit-search\.png$/);
    expect(existsSync(failed.evidence)).toBe(true);
    expect(await readdir(join(runDir, 'snapshots'))).toEqual([expect.stringMatching(/-submit-search\.json$/)]);
  });
});
