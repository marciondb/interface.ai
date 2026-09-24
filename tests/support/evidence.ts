import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// A replay or a discovery harness run.
export type EvidenceOf = { readonly evidenceRoot: string; readonly result: { readonly runId: string } };

export type RecordedEvent = Record<string, unknown>;

export function runDir(run: EvidenceOf): string {
  return join(run.evidenceRoot, run.result.runId);
}

export async function readEvents(run: EvidenceOf): Promise<RecordedEvent[]> {
  const text = await readFile(join(runDir(run), 'run.jsonl'), 'utf8');
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as RecordedEvent);
}

// Every file of the run except screenshots, as one string.
export async function evidenceText(run: EvidenceOf): Promise<string> {
  const entries = await readdir(runDir(run), { recursive: true, withFileTypes: true });
  const texts = await Promise.all(
    entries.filter((entry) => entry.isFile() && !entry.name.endsWith('.png')).map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8')),
  );
  return texts.join('\n');
}

export async function readSnapshots(run: EvidenceOf): Promise<{ frames: { url: string }[] }[]> {
  const dir = join(runDir(run), 'snapshots');
  const names = await readdir(dir);
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(dir, name), 'utf8')) as { frames: { url: string }[] }));
}
