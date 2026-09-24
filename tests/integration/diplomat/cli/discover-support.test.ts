import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { discoverySecrets, narrated } from '../../../../src/diplomat/cli/discover-support';
import { createFsRecorder } from '../../../../src/diplomat/evidence/fs-recorder';
import { loadConfig } from '../../../../src/infrastructure/config';

describe('discover CLI support', () => {
  it('narrates decisions redacted and without terminal control sequences, and still records them', async () => {
    const output = new PassThrough();
    let printed = '';
    output.on('data', (chunk: Buffer) => (printed += chunk.toString('utf8')));
    const recorder = createFsRecorder({ root: await mkdtemp(join(tmpdir(), 'narration-')), secrets: ['training'] });
    const run = await recorder.startRun({ mode: 'discovery', capabilityId: 'member.read-account-balance' });
    recorder.protect([{ value: '10001', sensitivity: 'internal' }]);

    await narrated(recorder, output).event({
      type: 'decision',
      stepId: 'step-2',
      verb: 'fill',
      target: 'e4',
      argument: '10001',
      rationale: 'type member 10001\u001b[2K\rpassword is training',
      latencyMs: 812,
      reasoner: { adapter: 'local', model: 'm' },
    });

    expect(printed).toBe('step-2 fill e4 "[REDACTED:internal]" (812 ms) model: type member [REDACTED:internal]password is [REDACTED:secret]\n');
    expect(await readFile(join(run.dir, 'run.jsonl'), 'utf8')).toContain('"verb":"fill"');
  });

  it('masks the hosted API key only when the hosted reasoner is used', () => {
    const config = loadConfig({ HOSTED_API_KEY: 'sk-abc', TARGET_PASSWORD: 'pw' });

    expect(discoverySecrets('hosted', config)).toEqual(['pw', 'sk-abc']);
    expect(discoverySecrets('local', config)).toEqual(['pw']);
    expect(discoverySecrets('hosted', loadConfig({ TARGET_PASSWORD: 'pw' }))).toEqual(['pw']);
  });
});
