import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExecutionResult } from '../../../src/models/execution-result';
import { at } from '../../support/at';
import { readEvents, readSnapshots, runDir } from '../../support/evidence';
import { startFixture, type FixtureHandle } from '../../support/fixture';
import { referenceCapabilities, runReplay, type HarnessOptions, type HarnessRun } from '../../support/replay-harness';

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

function failureOf(result: ExecutionResult) {
  if (result.status !== 'failed') throw new Error(`expected failed, got ${JSON.stringify(result)}`);
  return result.failure;
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
    const snapshot = at(await readSnapshots(replayRun), 0);
    expect(snapshot.frames.map((frame) => frame.url).filter((url) => url.includes('/login'))).toEqual([]);
  });

  it('escalates a step marked risky in the artifact without the gateway acting', async () => {
    const replayRun = await run('test.close-account', MARIA);

    const escalated = escalation(replayRun.result);
    expect(escalated).toMatchObject({ reason: 'no_operator_surface', stepId: 'close-account' });
    expect(escalated.interventionId).toMatch(/^int-/);
    expect(escalated.interventions).toEqual([escalated.interventionId]);
    expect(replayRun.driverCalls.filter((call) => call.stepId === 'close-account')).toEqual([]);
    const events = await readEvents(replayRun);
    expect(events.filter((event) => event.stepId === 'close-account').map((event) => event.type)).toEqual([
      'step_started',
      'target_resolved',
      'handoff_requested',
      'handoff_aborted',
      'result',
    ]);
    expect(events.find((event) => event.type === 'handoff_requested')).toMatchObject({ interventionId: escalated.interventionId, reason: 'risky_action' });
    const snapshot = at(await readSnapshots(replayRun), 0);
    const frameUrls = snapshot.frames.map((frame) => frame.url);
    expect(frameUrls.some((url) => url.includes('/member/detail'))).toBe(true);
    expect(frameUrls.filter((url) => url.includes('/member/danger/'))).toEqual([]);
    const screenshots = await readdir(join(runDir(replayRun), 'screenshots'));
    expect(screenshots).toEqual([expect.stringMatching(new RegExp(`-handoff-${escalated.interventionId}-before\\.png$`))]);
    expect(existsSync(join(runDir(replayRun), 'screenshots', at(screenshots, 0)))).toBe(true);
  });

  it('escalates a risky control the artifact marked safe, caught by the policy', async () => {
    const replayRun = await run('test.close-account-unmarked', MARIA);

    expect(replayRun.result).toMatchObject({ status: 'escalated', reason: 'no_operator_surface', stepId: 'close-account' });
    expect(replayRun.driverCalls.filter((call) => call.stepId === 'close-account')).toEqual([]);
    const policy = (await readEvents(replayRun)).find((event) => event.type === 'policy' && event.stepId === 'close-account');
    expect(policy).toMatchObject({ decision: 'requires_human', reason: 'destination: route /member/danger/close is risky' });
  });

  it('fails a step whose action landed outside the allowlist, though its destination was allowed', async () => {
    // The search form posts to /member/search, which redirects to /member/results.
    const replayRun = await run('member.read-account-balance', MARIA, {
      capabilitiesDir: await referenceCapabilities(),
      policy: (policy) => ({ ...policy, allowedRoutes: ['/', '/welcome', '/member/search', '/member/detail'] }),
    });

    expect(replayRun.result).toMatchObject({
      status: 'failed',
      failure: { stepId: 'submit-search', code: 'policy_denied', expected: 'click on lookup.search to stay within the policy' },
    });
    expect(failureOf(replayRun.result).observed).toMatch(/^landed_outside_allowlist at http:\/\/[^ ]+\/member\/results/);
    const policy = (await readEvents(replayRun)).find((event) => event.type === 'policy' && event.stepId === 'submit-search' && event.decision === 'deny');
    expect(policy?.reason).toMatch(/^landed_outside_allowlist at /);
    expect(replayRun.driverCalls.filter((call) => call.stepId === 'open-member-detail')).toEqual([]);
  });

  it('fails a step whose action landed on a risky route', async () => {
    const replayRun = await run('member.read-account-balance', MARIA, {
      capabilitiesDir: await referenceCapabilities(),
      policy: (policy) => ({ ...policy, risky: { ...policy.risky, routes: [...policy.risky.routes, '/member/results'] } }),
    });

    expect(replayRun.result).toMatchObject({ status: 'failed', failure: { stepId: 'submit-search', code: 'policy_denied' } });
    expect(failureOf(replayRun.result).observed).toMatch(/^landed_on_risky_route at /);
  });

  it('fails, rather than escalating, a risky step the policy denies', async () => {
    const replayRun = await run('test.close-account', MARIA, {
      policy: (policy) => ({ ...policy, allowedRoutes: ['/', '/welcome', '/member/search', '/member/results', '/member/detail'] }),
    });

    expect(replayRun.result).toMatchObject({
      status: 'failed',
      interventions: [],
      failure: { stepId: 'close-account', code: 'policy_denied', observed: 'destination: route /member/danger/close is not allowed' },
    });
    const events = await readEvents(replayRun);
    expect(events.some((event) => event.type === 'handoff_requested')).toBe(false);
    expect(events.find((event) => event.type === 'policy' && event.stepId === 'close-account')).toMatchObject({ decision: 'deny' });
  });

  it('refuses a target the policy denies before signing in', async () => {
    const replayRun = await run('member.read-account-balance', MARIA, {
      capabilitiesDir: await referenceCapabilities(),
      policy: (policy) => ({ ...policy, allowedRoutes: ['/member/*'] }),
    });

    expect(replayRun.result).toMatchObject({ status: 'failed', failure: { stepId: 'preconditions', code: 'policy_denied' } });
    expect(replayRun.sessionsEstablished).toBe(0);
  });

  it('honors the artifact risk even when the policy has no risky rules', async () => {
    const replayRun = await run('test.close-account', MARIA, { policy: (policy) => ({ ...policy, risky: { routes: [], controlText: [] } }) });

    expect(replayRun.result).toMatchObject({ status: 'escalated', reason: 'no_operator_surface', stepId: 'close-account' });
    expect(replayRun.driverCalls.filter((call) => call.stepId === 'close-account')).toEqual([]);
  });
});
