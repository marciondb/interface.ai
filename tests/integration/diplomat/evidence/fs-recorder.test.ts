import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFsRecorder } from '../../../../src/diplomat/evidence/fs-recorder';
import type { ExecutionResult } from '../../../../src/models/execution-result';
import { loginObservation } from '../../../support/observations';

const NOW = new Date('2026-09-24T12:34:56.789Z');

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'recorder-'));
}

describe('filesystem evidence recorder', () => {
  it('writes one redacted run folder with events, captures and the result', async () => {
    const root = await tempRoot();
    const recorder = createFsRecorder({
      root,
      now: () => NOW,
      redact: (record) => JSON.parse(JSON.stringify(record).replaceAll('hunter2', '[REDACTED]')) as unknown,
    });

    const run = await recorder.startRun({ mode: 'replay', capabilityId: 'member.read-account-balance' });
    await recorder.event({ type: 'session', event: 'established' });
    await recorder.event({ type: 'checkpoint', stepId: 'enter-member-id', holds: false, expected: 'hunter2', observed: 'x' });
    const paths = await recorder.failureCapture('enter-member-id', { screenshot: new Uint8Array([137, 80, 78, 71]), snapshot: loginObservation() });
    const result: ExecutionResult = {
      runId: run.runId,
      capability: { id: 'member.read-account-balance', version: '1.0.0' },
      durationMs: 5,
      recoveries: [],
      interventions: [],
      status: 'succeeded',
      outputs: { balance: 'hunter2' },
    };
    await recorder.finish(result);

    expect(run.runId).toBe('2026-09-24T12-34-56-789Z-replay-member.read-account-balance');
    expect(run.dir).toBe(join(root, run.runId));
    const lines = (await readFile(join(run.dir, 'run.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toEqual([
      { runId: run.runId, seq: 1, timestamp: NOW.toISOString(), type: 'session', event: 'established' },
      {
        runId: run.runId,
        seq: 2,
        timestamp: NOW.toISOString(),
        stepId: 'enter-member-id',
        type: 'checkpoint',
        holds: false,
        expected: '[REDACTED]',
        observed: 'x',
      },
    ]);
    expect(paths).toEqual({
      screenshot: join(run.dir, 'screenshots', '0002-enter-member-id.png'),
      snapshot: join(run.dir, 'snapshots', '0002-enter-member-id.json'),
    });
    expect(JSON.parse(await readFile(paths.snapshot ?? '', 'utf8'))).toEqual(loginObservation());
    expect(JSON.parse(await readFile(join(run.dir, 'result.json'), 'utf8'))).toMatchObject({ outputs: { balance: '[REDACTED]' } });
  });

  it('keeps runs that start in the same millisecond apart', async () => {
    const root = await tempRoot();
    const start = () => createFsRecorder({ root, now: () => NOW }).startRun({ mode: 'replay', capabilityId: 'a.b' });

    const first = await start();
    const second = await start();

    expect(second.runId).toBe(`${first.runId}-2`);
    expect(await readdir(root)).toHaveLength(2);
  });

  it('refuses events before the run starts', async () => {
    await expect(createFsRecorder({ root: await tempRoot() }).event({ type: 'session', event: 'opened' })).rejects.toThrow('startRun');
  });
});
