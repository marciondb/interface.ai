import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toCapabilityFile } from '../../../../src/adapters/capability-file';
import { createFsArtifactStore } from '../../../../src/diplomat/store/fs-store';

const ROOT = fileURLToPath(new URL('../../../../capabilities', import.meta.url));

// The contract: names, types, patterns, enums and sensitivity; descriptions are prose.
function contract(fields: Record<string, object>): Record<string, object> {
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, { ...field, description: undefined }]));
}

const committed = (await readdir(ROOT, { recursive: true }))
  .filter((file) => file.endsWith('.json'))
  .map((file) => {
    const [id = '', name = ''] = file.split('/');
    return { file, id, version: name.replace(/\.json$/, '') };
  });

describe('committed capabilities', () => {
  it('include the hand-written read-account-balance artifact', () => {
    expect(committed.map(({ file }) => file)).toContain('member.read-account-balance/1.0.0.json');
  });

  it.each(committed)('$file loads and is in canonical form', async ({ id, version }) => {
    const result = await createFsArtifactStore(ROOT).load(id, version);
    if (!result.ok) throw new Error(result.issues.join('\n'));
    const text = await readFile(result.path, 'utf8');
    expect(text).toBe(`${JSON.stringify(toCapabilityFile(result.capability), null, 2)}\n`);
  });

  // A committed draft would never replay by default: approval happens before the commit.
  it.each(committed)('$file is approved', async ({ id, version }) => {
    expect(await createFsArtifactStore(ROOT).load(id, version)).toMatchObject({ ok: true, status: 'approved' });
  });

  it('keep the hand-written reference steps in read-account-balance@1.0.0', async () => {
    const result = await createFsArtifactStore(ROOT).load('member.read-account-balance', '1.0.0');
    expect(result.ok && result.capability.steps.map((step) => step.id)).toEqual([
      'open-member-lookup',
      'enter-member-id',
      'submit-search',
      'open-member-detail',
      'read-balance',
    ]);
  });

  it.each([
    { id: 'member.read-account-balance', patch: '1.0.2' },
    { id: 'member.open-sub-account', patch: '1.0.1' },
  ])('resolve $id@1 to the discovered patch $patch, with the reference contract', async ({ id, patch }) => {
    const store = createFsArtifactStore(ROOT);
    const [latest, reference] = await Promise.all([store.loadLatest(id, 1), store.load(id, '1.0.0')]);
    if (!latest.ok || !reference.ok) throw new Error(`${id} artifacts did not load`);

    expect(latest.capability.capability.version).toBe(patch);
    expect(latest.capability.provenance).toMatchObject({ method: 'discovered', reasoner: { adapter: 'local' } });
    expect(contract(latest.capability.inputs)).toEqual(contract(reference.capability.inputs));
    expect(contract(latest.capability.outputs)).toEqual(contract(reference.capability.outputs));
  });
});
