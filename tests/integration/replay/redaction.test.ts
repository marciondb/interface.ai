import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evidenceText, readEvents, runDir } from '../../support/evidence';
import { startFixture, type FixtureHandle } from '../../support/fixture';
import { runReplay, type HarnessOptions, type HarnessRun } from '../../support/replay-harness';

const MARIA = { memberId: '10001', accountType: 'Savings' };

describe('replay evidence redaction against the fixture', { timeout: 30_000 }, () => {
  let fixture: FixtureHandle | undefined;

  beforeAll(async () => {
    fixture = await startFixture();
  }, 30_000);

  afterAll(async () => {
    await fixture?.stop();
  });

  function run(options?: HarnessOptions): Promise<HarnessRun> {
    if (fixture === undefined) throw new Error('fixture not started');
    return runReplay(fixture, MARIA, options);
  }

  it('returns the balance to the caller but masks it and the member id in the evidence', async () => {
    const replayRun = await run();

    expect(replayRun.result).toMatchObject({ status: 'succeeded', outputs: { balance: '4,812.37' } });
    const text = await evidenceText(replayRun);
    expect(text).not.toContain('4,812.37');
    expect(text).not.toContain('10001');
    expect(JSON.parse(await readFile(join(runDir(replayRun), 'result.json'), 'utf8'))).toMatchObject({
      outputs: { balance: '[REDACTED:financial]' },
    });
    const events = await readEvents(replayRun);
    expect(events.find((event) => event.type === 'output')).toMatchObject({ name: 'balance', value: '[REDACTED:financial]' });
    expect(events.find((event) => event.type === 'action' && event.stepId === 'enter-member-id')).toMatchObject({
      argument: '[REDACTED:internal]',
    });
  });

  it('keeps the password off the sign-in snapshot when the session expires twice', async () => {
    const replayRun = await run({ arm: { stepId: 'submit-search', kind: 'session_expired', times: 2 } });

    expect(replayRun.result).toMatchObject({ status: 'failed', failure: { code: 'session_expired' } });
    const snapshots = await readdir(join(runDir(replayRun), 'snapshots'));
    expect(snapshots).toEqual([expect.stringMatching(/-submit-search\.json$/)]);
    const snapshot = await readFile(join(runDir(replayRun), 'snapshots', snapshots[0]), 'utf8');
    expect(snapshot).toContain('/login');
    expect(snapshot).toContain('[REDACTED:secret]');
    expect(await evidenceText(replayRun)).not.toMatch(/training/i);
  });
});
