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
    const recorder = createFsRecorder({ root, now: () => NOW, secrets: ['hunter2'] });

    const run = await recorder.startRun({ mode: 'replay', capabilityId: 'member.read-account-balance' });
    await recorder.event({ type: 'session', event: 'established' });
    await recorder.event({ type: 'checkpoint', stepId: 'enter-member-id', holds: false, expected: 'hunter2', observed: 'value 4,812.37' });
    recorder.protect([{ value: '4,812.37', sensitivity: 'financial' }]);
    const snapshot = { ...loginObservation(), url: 'http://localhost:8080/?note=4,812.37' };
    const paths = await recorder.capture('enter-member-id', { screenshot: new Uint8Array([137, 80, 78, 71]), snapshot });
    const result: ExecutionResult = {
      runId: run.runId,
      capability: { id: 'member.read-account-balance', requestedMajor: 1, version: '1.0.0' },
      durationMs: 5,
      recoveries: [],
      interventions: [],
      status: 'succeeded',
      outputs: { balance: '4,812.37' },
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
        expected: '[REDACTED:secret]',
        // Written before protect(), masked again by finish().
        observed: 'value [REDACTED:financial]',
      },
    ]);
    expect(paths).toEqual({
      screenshot: join(run.dir, 'screenshots', '0002-enter-member-id.png'),
      snapshot: join(run.dir, 'snapshots', '0002-enter-member-id.json'),
    });
    expect(JSON.parse(await readFile(paths.snapshot ?? '', 'utf8'))).toEqual({
      ...loginObservation(),
      url: 'http://localhost:8080/?note=[REDACTED:financial]',
    });
    expect(JSON.parse(await readFile(join(run.dir, 'result.json'), 'utf8'))).toMatchObject({ outputs: { balance: '[REDACTED:financial]' } });
    expect(result.outputs.balance).toBe('4,812.37');
  });

  it('leaves no trace of a value protected at the last step in any file of the run', async () => {
    const recorder = createFsRecorder({ root: await tempRoot(), now: () => NOW });
    const run = await recorder.startRun({ mode: 'discovery', capabilityId: 'member.open-sub-account' });
    recorder.protect([{ value: '10001', sensitivity: 'internal' }]);
    const page = (text: string) => ({ ...loginObservation(), nodes: [{ role: 'text', name: text, frame: null }] });
    await recorder.capture('step-5', { snapshot: page('Balance 4,812.37') });
    await recorder.capture('step-12', { snapshot: page('New Account Number: 10001MMRAIN025000') });
    await recorder.event({ type: 'observation', stepId: 'step-12', observationId: 12, url: 'http://localhost:8080/?a=10001MMRAIN025000', elements: 1 });
    recorder.protect([
      { value: '4,812.37', sensitivity: 'financial' },
      { value: '10001MMRAIN025000', sensitivity: 'financial' },
    ]);
    await recorder.finish({
      runId: run.runId,
      capability: { id: 'member.open-sub-account', version: '1.0.0' },
      reasoner: { adapter: 'local', model: 'm' },
      durationMs: 1,
      steps: 12,
      interventions: [],
      status: 'succeeded',
      outputs: { accountNumber: '10001MMRAIN025000' },
    });

    const files = (await readdir(run.dir, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile());
    expect(files.map((entry) => entry.name).toSorted()).toEqual(['0000-step-12.json', '0000-step-5.json', 'result.json', 'run.jsonl']);
    const text = (await Promise.all(files.map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8')))).join('\n');
    expect(text).not.toMatch(/4,812\.37|MMRAIN025000/);
    expect(text).toContain('New Account Number: [REDACTED:financial]');
    expect(text).toContain('Balance [REDACTED:financial]');
  });

  it('redacts values for display with the same rules', async () => {
    const recorder = createFsRecorder({ root: await tempRoot(), secrets: ['hunter2'] });
    recorder.protect([{ value: '10001', sensitivity: 'internal' }]);

    expect(recorder.redact({ argument: '10001', rationale: 'type hunter2' })).toEqual({ argument: '[REDACTED:internal]', rationale: 'type [REDACTED:secret]' });
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
