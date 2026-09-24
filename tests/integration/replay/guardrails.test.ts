import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExecutionResult } from '../../../src/models/execution-result';
import { readEvents, readSnapshots, runDir } from '../../support/evidence';
import { startFixture, type FixtureHandle } from '../../support/fixture';
import { runReplay, type HarnessOptions, type HarnessRun } from '../../support/replay-harness';

const MARIA = { memberId: '10001', accountType: 'Savings' };

type CapabilityFile = Record<string, unknown> & { steps: Record<string, unknown>[]; targets: Record<string, unknown> };

// Test-only artifacts, derived from the committed one so they stay valid and in step with it.
async function writeTestCapabilities(root: string): Promise<void> {
  const base = JSON.parse(
    await readFile(new URL('../../../capabilities/member.read-account-balance/1.0.0.json', import.meta.url), 'utf8'),
  ) as CapabilityFile;
  const info = (id: string) => ({ ...(base.capability as object), id, version: '1.0.0', description: `Guardrail test ${id}` });

  const closeAccount = (id: string, risk: 'safe' | 'risky'): CapabilityFile => ({
    ...base,
    capability: info(id),
    outputs: {},
    targets: {
      ...base.targets,
      'detail.closeAccount': { frame: 'content', candidates: [{ strategy: 'role', role: 'button', name: 'Close Account' }] },
    },
    steps: [
      ...base.steps.filter((step) => step.id !== 'read-balance'),
      {
        id: 'close-account',
        action: { kind: 'click', target: 'detail.closeAccount' },
        risk,
        checkpoint: { kind: 'text_visible', text: 'Account closure has been submitted', frame: 'content' },
      },
    ],
  });

  const files: CapabilityFile[] = [
    {
      ...base,
      capability: info('test.navigate-outside'),
      inputs: {},
      outputs: {},
      targets: {},
      steps: [{ id: 'sign-off', action: { kind: 'navigate', path: '/logout' }, risk: 'safe', checkpoint: { kind: 'text_visible', text: 'Sign On' } }],
      outcomes: [],
    },
    closeAccount('test.close-account', 'risky'),
    closeAccount('test.close-account-unmarked', 'safe'),
  ];
  for (const file of files) {
    const id = (file.capability as { id: string }).id;
    await mkdir(join(root, id), { recursive: true });
    await writeFile(join(root, id, '1.0.0.json'), JSON.stringify(file, null, 2));
  }
}

function escalation(result: ExecutionResult) {
  if (result.status !== 'escalated') throw new Error(`expected escalated, got ${JSON.stringify(result)}`);
  return result;
}

describe('replay guardrails against the fixture', { timeout: 30_000 }, () => {
  let fixture: FixtureHandle | undefined;
  let capabilitiesDir = '';

  beforeAll(async () => {
    capabilitiesDir = await mkdtemp(join(tmpdir(), 'guardrail-capabilities-'));
    await writeTestCapabilities(capabilitiesDir);
    fixture = await startFixture();
  }, 30_000);

  afterAll(async () => {
    await fixture?.stop();
  });

  function run(capability: string, inputs: Record<string, string>, options: HarnessOptions = {}): Promise<HarnessRun> {
    if (fixture === undefined) throw new Error('fixture not started');
    return runReplay(fixture, inputs, { capability, capabilitiesDir, ...options });
  }

  it('denies a navigation outside the allowlist without calling the driver', async () => {
    const replayRun = await run('test.navigate-outside', {});

    expect(replayRun.result).toMatchObject({ status: 'failed', failure: { stepId: 'sign-off', code: 'policy_denied' } });
    expect(replayRun.driverCalls.filter((call) => call.stepId === 'sign-off')).toEqual([]);
    const policy = (await readEvents(replayRun)).find((event) => event.type === 'policy' && event.stepId === 'sign-off');
    expect(policy).toMatchObject({ decision: 'deny', reason: 'destination: route /logout is not allowed' });
    const [snapshot] = await readSnapshots(replayRun);
    expect(snapshot.frames.map((frame) => frame.url).filter((url) => url.includes('/login'))).toEqual([]);
  });

  it('escalates a step marked risky in the artifact before the gateway is asked', async () => {
    const replayRun = await run('test.close-account', MARIA);

    const escalated = escalation(replayRun.result);
    expect(escalated).toMatchObject({ reason: 'risky_action', stepId: 'close-account' });
    expect(escalated.interventionId).toMatch(/^int-/);
    expect(replayRun.driverCalls.filter((call) => call.stepId === 'close-account')).toEqual([]);
    const events = await readEvents(replayRun);
    expect(events.filter((event) => event.stepId === 'close-account').map((event) => event.type)).toEqual([
      'step_started',
      'target_resolved',
      'escalation',
      'result',
    ]);
    expect(events.find((event) => event.type === 'escalation')).toMatchObject({ interventionId: escalated.interventionId, reason: 'risky_action' });
    const [snapshot] = await readSnapshots(replayRun);
    const frameUrls = snapshot.frames.map((frame) => frame.url);
    expect(frameUrls.some((url) => url.includes('/member/detail'))).toBe(true);
    expect(frameUrls.filter((url) => url.includes('/member/danger/'))).toEqual([]);
    const screenshots = await readdir(join(runDir(replayRun), 'screenshots'));
    expect(screenshots).toEqual([expect.stringMatching(/-close-account\.png$/)]);
    expect(existsSync(join(runDir(replayRun), 'screenshots', screenshots[0]))).toBe(true);
  });

  it('escalates a risky control the artifact marked safe, caught by the policy', async () => {
    const replayRun = await run('test.close-account-unmarked', MARIA);

    expect(replayRun.result).toMatchObject({ status: 'escalated', reason: 'risky_action', stepId: 'close-account' });
    expect(replayRun.driverCalls.filter((call) => call.stepId === 'close-account')).toEqual([]);
    const policy = (await readEvents(replayRun)).find((event) => event.type === 'policy' && event.stepId === 'close-account');
    expect(policy).toMatchObject({ decision: 'requires_human', reason: 'destination: route /member/danger/close is risky' });
  });

  it('honors the artifact risk even when the policy has no risky rules', async () => {
    const replayRun = await run('test.close-account', MARIA, { policy: (policy) => ({ ...policy, risky: { routes: [], controlText: [] } }) });

    expect(replayRun.result).toMatchObject({ status: 'escalated', reason: 'risky_action', stepId: 'close-account' });
    expect(replayRun.driverCalls.filter((call) => call.stepId === 'close-account')).toEqual([]);
  });
});
