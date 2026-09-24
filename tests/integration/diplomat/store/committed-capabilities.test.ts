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

  it('resolve read-account-balance@1 to the reference steps', async () => {
    const result = await createFsArtifactStore(ROOT).loadLatest('member.read-account-balance', 1);
    expect(result.ok && result.capability.steps.map((step) => step.id)).toEqual([
      'open-member-lookup',
      'enter-member-id',
      'submit-search',
      'open-member-detail',
      'read-balance',
    ]);
  });
});
