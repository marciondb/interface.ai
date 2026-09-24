import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toCapabilityFile } from '../../adapters/capability-file';
import { toEvidenceRecord } from '../../adapters/evidence-record';
import { errnoCode } from '../../infrastructure/errors';
import { redactDeep, type SensitiveValue } from '../../logic/redaction';
import type { CapturePaths, EvidenceRecorder, EvidenceRun } from './port';

export type FsRecorderOptions = {
  // Evidence root; each run gets <root>/<timestamp>-<mode>-<capability-id>/.
  readonly root: string;
  // Masked wherever they appear, e.g. the target password (ADR-013).
  readonly secrets?: readonly string[];
  readonly now?: () => Date;
};

export function createFsRecorder(options: FsRecorderOptions): EvidenceRecorder {
  const secrets = options.secrets ?? [];
  const sensitive: SensitiveValue[] = [];
  const redact = <T>(value: T): T => redactDeep(value, { secrets, sensitive });
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

  function jsonLine(record: unknown): string {
    return `${JSON.stringify(redact(record))}\n`;
  }

  function redactedAgain(name: string, text: string): string {
    if (name.endsWith('.json')) return `${json(JSON.parse(text) as unknown)}\n`;
    return text
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => jsonLine(JSON.parse(line) as unknown))
      .join('');
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
          if (errnoCode(error) === 'EEXIST') continue;
          throw error;
        }
        run = { runId, dir };
        return run;
      }
    },

    protect(values) {
      sensitive.push(...values);
    },

    redact,

    async event(event) {
      const { runId, dir } = active();
      seq += 1;
      const record = toEvidenceRecord(event, { runId, seq, timestamp: now().toISOString() });
      await appendFile(join(dir, 'run.jsonl'), jsonLine(record), 'utf8');
    },

    async capture(stepId, capture) {
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

    async intervention(request) {
      await writeFile(join(active().dir, 'intervention.json'), `${json(request)}\n`, 'utf8');
    },

    async artifact(capability) {
      await writeFile(join(active().dir, 'artifact.json'), `${json(toCapabilityFile(capability))}\n`, 'utf8');
    },

    async finish(result) {
      const { dir } = active();
      await writeFile(join(dir, 'result.json'), `${json(result)}\n`, 'utf8');
      const entries = await readdir(dir, { recursive: true, withFileTypes: true });
      for (const entry of entries.filter((item) => item.isFile() && /\.jsonl?$/.test(item.name))) {
        const path = join(entry.parentPath, entry.name);
        const text = await readFile(path, 'utf8');
        const redacted = redactedAgain(entry.name, text);
        if (redacted !== text) await writeFile(path, redacted, 'utf8');
      }
    },
  };
}
