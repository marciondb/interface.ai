import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toCapabilityFile } from '../../../../src/adapters/capability-file';
import { createFsArtifactStore } from '../../../../src/diplomat/store/fs-store';

const ROOT = fileURLToPath(new URL('../../../../capabilities', import.meta.url));

const committed = (await readdir(ROOT, { recursive: true }))
  .filter((file) => file.endsWith('.json'))
  .map((file) => {
    const [id, name] = file.split('/');
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

  it('resolve read-account-balance@1 to the discovered patch, with the same contract', async () => {
    const store = createFsArtifactStore(ROOT);
    const [latest, reference] = await Promise.all([
      store.loadLatest('member.read-account-balance', 1),
      store.load('member.read-account-balance', '1.0.0'),
    ]);
    if (!latest.ok || !reference.ok) throw new Error('read-account-balance artifacts did not load');

    expect(latest.capability.capability.version).toBe('1.0.1');
    expect(latest.capability.provenance).toMatchObject({ method: 'discovered', reasoner: { adapter: 'local' } });
    expect(latest.capability.inputs).toEqual(reference.capability.inputs);
    expect(latest.capability.outputs).toEqual(reference.capability.outputs);
  });
});
