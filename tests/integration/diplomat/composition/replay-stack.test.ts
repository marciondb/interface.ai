import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPABILITIES_DIR } from '../../../../src/diplomat/composition/shared';
import { startFixture, type FixtureHandle } from '../../../support/fixture';
import { MARIA, MARIA_SAVINGS_BALANCE } from '../../../support/fixture-data';
import { runReplay } from '../../../support/replay-harness';

const READ_BALANCE = 'member.read-account-balance';

// A store whose only read-account-balance artifact is a draft (the hand-written 1.0.0 marked so).
async function draftOnlyStore(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'draft-capabilities-'));
  await mkdir(join(dir, READ_BALANCE));
  const file = JSON.parse(await readFile(join(CAPABILITIES_DIR, READ_BALANCE, '1.0.0.json'), 'utf8')) as Record<string, unknown>;
  await writeFile(join(dir, READ_BALANCE, '1.0.0.json'), JSON.stringify({ ...file, status: 'draft' }));
  return dir;
}

describe('replay stack', () => {
  let fixture: FixtureHandle | undefined;
  let capabilitiesDir = '';

  beforeAll(async () => {
    fixture = await startFixture();
    capabilitiesDir = await draftOnlyStore();
  });

  afterAll(async () => {
    await fixture?.stop();
  });

  function started(): FixtureHandle {
    if (fixture === undefined) throw new Error('fixture not started');
    return fixture;
  }

  it('skips drafts by default', async () => {
    const { result } = await runReplay(started(), MARIA, { capabilitiesDir });

    expect(result).toMatchObject({ status: 'failed', failure: { stepId: 'artifact', code: 'artifact_unavailable' } });
  });

  it('replays a draft with allowDraft (the CLI --allow-draft)', async () => {
    const { result } = await runReplay(started(), MARIA, { capabilitiesDir, allowDraft: true });

    expect(result).toMatchObject({ status: 'succeeded', outputs: { balance: MARIA_SAVINGS_BALANCE }, capability: { version: '1.0.0' } });
  });
});
