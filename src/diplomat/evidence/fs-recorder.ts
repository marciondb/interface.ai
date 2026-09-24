import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toEvidenceRecord } from '../../adapters/evidence-record';
import type { CapturePaths, EvidenceRecorder, EvidenceRun } from './port';

export type FsRecorderOptions = {
  // Evidence root; each run gets <root>/<timestamp>-<mode>-<capability-id>/.
  readonly root: string;
  // Applied to every record before it is written (RFC-006); identity by default.
  readonly redact?: (record: unknown) => unknown;
  readonly now?: () => Date;
};

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST';
}

export function createFsRecorder(options: FsRecorderOptions): EvidenceRecorder {
  const redact = options.redact ?? ((record: unknown) => record);
  const now = options.now ?? (() => new Date());
  let run: EvidenceRun | undefined;
  let seq = 0;

  function active(): EvidenceRun {
    if (run === undefined) throw new Error('evidence: startRun() has not been called');
    return run;
  }

  function json(record: unknown): string {
    return JSON.stringify(redact(record), null, 2);
  }

  return {
    async startRun({ mode, capabilityId }) {
      if (run !== undefined) throw new Error('evidence: a recorder holds a single run');
      await mkdir(options.root, { recursive: true });
      const stamp = now().toISOString().replace(/[:.]/g, '-');
      for (let attempt = 1; ; attempt += 1) {
        const runId = `${stamp}-${mode}-${capabilityId}${attempt === 1 ? '' : `-${String(attempt)}`}`;
        const dir = join(options.root, runId);
        try {
          await mkdir(dir);
        } catch (error) {
          if (isAlreadyExists(error)) continue;
          throw error;
        }
        run = { runId, dir };
        return run;
      }
    },

    async event(event) {
      const { runId, dir } = active();
      seq += 1;
      const record = toEvidenceRecord(event, { runId, seq, timestamp: now().toISOString() });
      await appendFile(join(dir, 'run.jsonl'), `${JSON.stringify(redact(record))}\n`, 'utf8');
    },

    async failureCapture(stepId, capture) {
      const { dir } = active();
      const name = `${String(seq).padStart(4, '0')}-${stepId}`;
      const paths: { screenshot?: string; snapshot?: string } = {};
      if (capture.screenshot !== undefined) {
        await mkdir(join(dir, 'screenshots'), { recursive: true });
        paths.screenshot = join(dir, 'screenshots', `${name}.png`);
        await writeFile(paths.screenshot, capture.screenshot);
      }
      if (capture.snapshot !== undefined) {
        await mkdir(join(dir, 'snapshots'), { recursive: true });
        paths.snapshot = join(dir, 'snapshots', `${name}.json`);
        await writeFile(paths.snapshot, `${json(capture.snapshot)}\n`, 'utf8');
      }
      return paths satisfies CapturePaths;
    },

    async finish(result) {
      await writeFile(join(active().dir, 'result.json'), `${json(result)}\n`, 'utf8');
    },
  };
}
