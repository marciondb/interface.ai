import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fromCapabilityFile } from '../../../../src/adapters/capability-file';
import { createFsArtifactStore } from '../../../../src/diplomat/store/fs-store';
import type { Capability } from '../../../../src/models/capability';
import { capabilityFile } from '../../../support/capabilities';

const ID = 'member.read-account-balance';

function capability(version = '1.0.0'): Capability {
  const file = capabilityFile();
  file.capability.version = version;
  const result = fromCapabilityFile(file);
  if (!result.ok) throw new Error(result.issues.join('\n'));
  return result.capability;
}

async function writeRaw(root: string, version: string, text: string): Promise<void> {
  await mkdir(join(root, ID), { recursive: true });
  await writeFile(join(root, ID, `${version}.json`), text);
}

describe('fs artifact store', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'artifact-store-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('saves a capability and loads it back', async () => {
    const store = createFsArtifactStore(root);
    const path = join(root, ID, '1.0.0.json');
    expect(await store.save(capability())).toEqual({ ok: true, path });
    expect(await store.load(ID, '1.0.0')).toEqual({ ok: true, capability: capability(), path });
    expect(await store.loadLatest(ID, 1)).toEqual({ ok: true, capability: capability(), path });
  });

  it('writes pretty-printed JSON with schemaVersion first and a trailing newline', async () => {
    await createFsArtifactStore(root).save(capability());
    const text = await readFile(join(root, ID, '1.0.0.json'), 'utf8');
    expect(text.startsWith('{\n  "schemaVersion": 1,\n  "capability": {')).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('picks the highest version within the requested major', async () => {
    const store = createFsArtifactStore(root);
    for (const version of ['1.0.0', '1.2.0', '1.10.1', '2.0.0']) await store.save(capability(version));
    await writeRaw(root, 'README', 'not an artifact');

    const latest = await store.loadLatest(ID, 1);
    expect(latest.ok && latest.capability.capability.version).toBe('1.10.1');
    const next = await store.loadLatest(ID, 2);
    expect(next.ok && next.capability.capability.version).toBe('2.0.0');
  });

  it('reports not_found for a missing version, major or capability', async () => {
    const store = createFsArtifactStore(root);
    await store.save(capability());
    expect(await store.load(ID, '1.1.0')).toMatchObject({ ok: false, code: 'not_found' });
    expect(await store.loadLatest(ID, 3)).toMatchObject({ ok: false, code: 'not_found' });
    expect(await store.loadLatest('member.unknown', 1)).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('reports invalid JSON with issues', async () => {
    await writeRaw(root, '1.0.0', '{ "schemaVersion": 1,');
    const result = await createFsArtifactStore(root).load(ID, '1.0.0');
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    expect(result.ok || result.issues[0]).toMatch(/^\(file\): /);
  });

  it('reports a schema violation with issues', async () => {
    await writeRaw(root, '1.0.0', JSON.stringify({ ...capabilityFile(), schemaVersion: 2 }));
    const result = await createFsArtifactStore(root).loadLatest(ID, 1);
    expect(result).toMatchObject({ ok: false, code: 'invalid', issues: ['schemaVersion: Invalid input: expected 1'] });
  });

  it('reports a file whose id or version does not match its path', async () => {
    const file = capabilityFile();
    await writeRaw(root, '1.0.1', JSON.stringify(file));
    const result = await createFsArtifactStore(root).load(ID, '1.0.1');
    expect(result).toMatchObject({
      ok: false,
      code: 'invalid',
      issues: [`capability: file declares ${ID}@1.0.0, path expects ${ID}@1.0.1`],
    });
  });

  it('refuses to overwrite a published version', async () => {
    const store = createFsArtifactStore(root);
    await store.save(capability());
    const changed = { ...capability(), notes: 'changed' };
    expect(await store.save(changed)).toMatchObject({ ok: false, code: 'exists' });
    const loaded = await store.load(ID, '1.0.0');
    expect(loaded.ok && loaded.capability.notes).toBeUndefined();
  });

  it('refuses to save an invalid capability', async () => {
    const broken = capability();
    broken.steps = [];
    const result = await createFsArtifactStore(root).save(broken);
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    expect(await createFsArtifactStore(root).load(ID, '1.0.0')).toMatchObject({ code: 'not_found' });
  });

  it('rejects ids and versions that would escape the store root', async () => {
    const store = createFsArtifactStore(root);
    expect(await store.load('../outside', '1.0.0')).toMatchObject({ ok: false, code: 'invalid' });
    expect(await store.load(ID, '../../1.0.0')).toMatchObject({ ok: false, code: 'invalid' });
    expect(await store.loadLatest(ID, -1)).toMatchObject({ ok: false, code: 'invalid' });
  });
});
