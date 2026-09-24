import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fromCapabilityFile, toCapabilityFile } from '../../adapters/capability-file';
import { CapabilityIdSchema, SemverSchema, type Capability } from '../../models/capability';
import type { ArtifactStore, LoadResult, SaveResult } from './port';

const VERSION_FILE = /^([0-9]+)\.([0-9]+)\.([0-9]+)\.json$/;

export function createFsArtifactStore(rootDir: string): ArtifactStore {
  const fileOf = (id: string, version: string) => join(rootDir, id, `${version}.json`);

  async function load(id: string, version: string): Promise<LoadResult> {
    const path = fileOf(id, version);
    const refused = checkReference(id, version);
    if (refused.length > 0) return { ok: false, code: 'invalid', path, issues: refused };

    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return { ok: false, code: 'not_found', path, issues: [`no artifact at ${path}`] };
      throw error;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      return { ok: false, code: 'invalid', path, issues: [`(file): ${(error as Error).message}`] };
    }

    const parsed = fromCapabilityFile(raw);
    if (!parsed.ok) return { ok: false, code: 'invalid', path, issues: parsed.issues };
    const { capability } = parsed;
    if (capability.capability.id !== id || capability.capability.version !== version) {
      const found = `${capability.capability.id}@${capability.capability.version}`;
      return { ok: false, code: 'invalid', path, issues: [`capability: file declares ${found}, path expects ${id}@${version}`] };
    }
    return { ok: true, capability, path };
  }

  async function loadLatest(id: string, major: number): Promise<LoadResult> {
    const dir = join(rootDir, id);
    const refused = checkReference(id, `${String(major)}.0.0`);
    if (refused.length > 0) return { ok: false, code: 'invalid', path: dir, issues: refused };

    let files: string[];
    try {
      files = await readdir(dir);
    } catch (error) {
      if (isNotFound(error)) return { ok: false, code: 'not_found', path: dir, issues: [`no artifacts for ${id}`] };
      throw error;
    }

    const latest = files
      .map((file) => VERSION_FILE.exec(file))
      .filter((match) => match !== null)
      .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])])
      .filter(([fileMajor]) => fileMajor === major)
      .sort((a, b) => b[1] - a[1] || b[2] - a[2])
      .at(0);
    if (latest === undefined) {
      return { ok: false, code: 'not_found', path: dir, issues: [`no ${id} artifact with major version ${String(major)}`] };
    }
    return load(id, latest.join('.'));
  }

  async function save(capability: Capability): Promise<SaveResult> {
    const { id, version } = capability.capability;
    const path = fileOf(id, version);
    const file = toCapabilityFile(capability);
    const checked = fromCapabilityFile(file);
    if (!checked.ok) return { ok: false, code: 'invalid', path, issues: checked.issues };

    await mkdir(join(rootDir, id), { recursive: true });
    try {
      await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (isAlreadyExists(error)) {
        return { ok: false, code: 'exists', path, issues: [`${id}@${version} is already published`] };
      }
      throw error;
    }
    return { ok: true, path };
  }

  return { load, loadLatest, save };
}

// Keeps caller-supplied ids and versions from escaping the store root.
function checkReference(id: string, version: string): string[] {
  const issues: string[] = [];
  if (!CapabilityIdSchema.safeParse(id).success) issues.push(`capability id ${JSON.stringify(id)} is malformed`);
  if (!SemverSchema.safeParse(version).success) issues.push(`version ${JSON.stringify(version)} is malformed`);
  return issues;
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST';
}
