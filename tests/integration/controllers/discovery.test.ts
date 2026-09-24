import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromCapabilityFile } from '../../../src/adapters/capability-file';
import type { Clock } from '../../../src/infrastructure/clock';
import { DiscoveryResultSchema, type DiscoveryResult } from '../../../src/models/discovery';
import { runDiscovery, type DiscoveryHarnessOptions, type DiscoveryHarnessRun } from '../../support/discovery-harness';
import { startFixture, type FixtureHandle } from '../../support/fixture';
import { PASSWORD, runReplay } from '../../support/replay-harness';
import { createScriptedReasoner, READ_FLOW, type ScriptedReasoner, type ScriptedStep } from '../../support/scripted-reasoner';

const ARTIFACT = join('member.read-account-balance', '1.0.1.json');

function runFolder(run: DiscoveryHarnessRun): string {
  return join(run.evidenceRoot, run.result.runId);
}

async function events(run: DiscoveryHarnessRun): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(runFolder(run), 'run.jsonl'), 'utf8');
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function evidenceText(run: DiscoveryHarnessRun): Promise<string> {
  const entries = await readdir(runFolder(run), { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && !entry.name.endsWith('.png'));
  return (await Promise.all(files.map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8')))).join('\n');
}

function expectStatus<S extends DiscoveryResult['status']>(result: DiscoveryResult, status: S): Extract<DiscoveryResult, { status: S }> {
  expect(DiscoveryResultSchema.parse(result).status).toBe(status);
  return result as Extract<DiscoveryResult, { status: S }>;
}

// Fills the member id, then keeps answering with `step`.
function afterLookup(...steps: ScriptedStep[]): ScriptedStep[] {
  return [READ_FLOW[0], READ_FLOW[1], ...steps];
}

describe('discovery controller against the fixture', { timeout: 60_000 }, () => {
  let fixture: FixtureHandle | undefined;

  beforeAll(async () => {
    fixture = await startFixture();
  }, 30_000);

  afterAll(async () => {
    await fixture?.stop();
  });

  function discover(reasoner: ScriptedReasoner, options?: DiscoveryHarnessOptions): Promise<DiscoveryHarnessRun> {
    if (fixture === undefined) throw new Error('fixture not started');
    return runDiscovery(fixture, reasoner, options);
  }

  describe('the read flow', () => {
    let run: DiscoveryHarnessRun | undefined;

    beforeAll(async () => {
      run = await discover(createScriptedReasoner(READ_FLOW));
    }, 60_000);

    function discovered(): DiscoveryHarnessRun {
      if (run === undefined) throw new Error('discovery did not run');
      return run;
    }

    it('succeeds and publishes a valid artifact with discovered provenance', async () => {
      const { result, capabilitiesDir } = discovered();

      expect(expectStatus(result, 'succeeded')).toMatchObject({ outputs: { balance: '4,812.37' }, steps: 6 });
      const file = fromCapabilityFile(JSON.parse(await readFile(join(capabilitiesDir, ARTIFACT), 'utf8')));
      if (!file.ok) throw new Error(file.issues.join('; '));
      expect(file.capability.provenance).toMatchObject({
        method: 'discovered',
        runId: result.runId,
        reasoner: { adapter: 'local', model: 'scripted' },
      });
      expect(file.capability.steps.map((step) => step.id)).toEqual(['click-member-lookup', 'fill-member-id', 'click-search', 'click-name', 'read-balance']);
    });

    it('writes redacted evidence with every decision rationale and the artifact', async () => {
      const discovery = discovered();
      const log = await events(discovery);
      const text = await evidenceText(discovery);

      expect(log.filter((event) => event.type === 'decision').every((event) => typeof event.rationale === 'string')).toBe(true);
      expect(log.filter((event) => event.type === 'decision')).toHaveLength(6);
      expect(await readdir(runFolder(discovery))).toEqual(expect.arrayContaining(['artifact.json', 'result.json', 'run.jsonl', 'screenshots', 'snapshots']));
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain('10001');
      // Masked from the read on (RFC-006); what was written before shows the screen as it was.
      const read = log.find((event) => event.type === 'action' && event.verb === 'read');
      const fromRead = log.filter((event) => typeof read?.seq === 'number' && typeof event.seq === 'number' && event.seq >= read.seq);
      expect(fromRead.length).toBeGreaterThan(0);
      expect(JSON.stringify(fromRead)).not.toContain('4,812.37');
      expect(await readFile(join(runFolder(discovery), 'result.json'), 'utf8')).not.toContain('4,812.37');
      expect(log.find((event) => event.type === 'output')).toMatchObject({ name: 'balance', value: '[REDACTED:financial]' });
    });

    it('produces an artifact that replays for another member without the model', async () => {
      if (fixture === undefined) throw new Error('fixture not started');
      const { capabilitiesDir } = discovered();

      const james = await runReplay(fixture, { memberId: '10002', accountType: 'Savings' }, { capabilitiesDir });
      const missing = await runReplay(fixture, { memberId: '99999', accountType: 'Savings' }, { capabilitiesDir });

      expect(james.result).toMatchObject({ status: 'succeeded', outputs: { balance: '3,100.55' }, capability: { version: '1.0.1' } });
      expect(missing.result).toMatchObject({ status: 'business_outcome', outcome: 'member_not_found' });
    });

    it('refuses to run again once the version is published', async () => {
      const { capabilitiesDir } = discovered();
      const reasoner = createScriptedReasoner(READ_FLOW);

      const again = await discover(reasoner, { capabilitiesDir });

      expect(expectStatus(again.result, 'failed')).toMatchObject({ reason: 'artifact_exists', steps: 0 });
      expect(reasoner.inputs).toHaveLength(0);
      expect(again.driverCalls).toHaveLength(0);
    });
  });

  it('rejects a ref that is not on the screen without touching the surface, and says so', async () => {
    const reasoner = createScriptedReasoner([() => ({ verb: 'click', target: 'e999', argument: null, rationale: 'stale' })]);

    const run = await discover(reasoner);

    expect(expectStatus(run.result, 'failed')).toMatchObject({ reason: 'reasoner_exhausted' });
    expect(run.driverCalls).toHaveLength(0);
    expect(reasoner.inputs[1]?.feedback).toBe('e999 is not on the current screen');
    expect((await events(run)).some((event) => event.type === 'grounding_rejected' && event.target === 'e999')).toBe(true);
  });

  it('feeds a policy denial back to the model instead of navigating off the allowlist', async () => {
    const reasoner = createScriptedReasoner([{ verb: 'navigate', argument: 'https://example.com/' }]);

    const run = await discover(reasoner);

    expect(expectStatus(run.result, 'failed')).toMatchObject({ reason: 'reasoner_exhausted' });
    expect(run.driverCalls).toHaveLength(0);
    expect(reasoner.inputs[1]?.feedback).toMatch(/^your previous navigate was denied: destination: origin https:\/\/example.com is not allowed$/);
  });

  it('escalates after three actions that change nothing', async () => {
    const noop: ScriptedStep = { verb: 'click', find: { role: 'cell', name: 'MAIN MENU' } };

    const run = await discover(createScriptedReasoner([noop, noop, noop, noop]));

    expect(expectStatus(run.result, 'escalated')).toMatchObject({ reason: 'no_operator_surface', stepId: 'step-3' });
    expect(run.escalations).toMatchObject([{ reason: 'stalled', stepId: 'step-3', mode: 'discovery' }]);
    expect(run.driverCalls).toHaveLength(3);
  });

  it('escalates when the model asks for help', async () => {
    const run = await discover(createScriptedReasoner([{ verb: 'request_help', argument: 'I cannot find the member' }]));

    expect(expectStatus(run.result, 'escalated')).toMatchObject({
      reason: 'no_operator_surface',
      message: 'I cannot find the member (handoff no_operator_surface)',
    });
    expect(run.escalations).toMatchObject([{ reason: 'help_requested', message: 'I cannot find the member' }]);
  });

  it('escalates instead of performing a risky action', async () => {
    const run = await discover(
      createScriptedReasoner(
        afterLookup(READ_FLOW[2], READ_FLOW[3], { verb: 'click', find: { role: 'button', name: 'Close Account' } }),
      ),
    );

    expect(expectStatus(run.result, 'escalated')).toMatchObject({ reason: 'no_operator_surface', stepId: 'step-5' });
    expect(run.escalations).toMatchObject([{ reason: 'risky_action', stepId: 'step-5' }]);
    expect(run.driverCalls.map((action) => action.verb)).toEqual(['click', 'fill', 'click', 'click']);
  });

  it('keeps going after finish while an output is still unread', async () => {
    const reasoner = createScriptedReasoner([{ verb: 'finish' }]);

    const run = await discover(reasoner);

    expect(expectStatus(run.result, 'failed')).toMatchObject({ reason: 'reasoner_exhausted' });
    expect(reasoner.inputs[1]?.feedback).toBe('the goal is not complete: not read yet: balance');
  });

  it('fails when the step budget runs out', async () => {
    const run = await discover(createScriptedReasoner(READ_FLOW), { limits: { maxSteps: 3, timeoutMs: 600_000, maxStalls: 3 } });

    expect(expectStatus(run.result, 'failed')).toMatchObject({ reason: 'step_budget', steps: 3 });
  });

  it('fails when the wall-clock budget runs out', async () => {
    let now = 0;
    const clock: Clock = { now: () => (now += 1_000), sleep: () => Promise.resolve() };

    const run = await discover(createScriptedReasoner(READ_FLOW), { clock, limits: { maxSteps: 25, timeoutMs: 5_000, maxStalls: 3 } });

    expect(expectStatus(run.result, 'failed')).toMatchObject({ reason: 'timeout' });
  });

  it('fails when the reasoner gives up', async () => {
    const run = await discover(createScriptedReasoner([]));

    expect(expectStatus(run.result, 'failed')).toMatchObject({ reason: 'reasoner_exhausted', steps: 1 });
  });

  it('fails without a model call when the artifact version already exists', async () => {
    const capabilitiesDir = await mkdtemp(join(tmpdir(), 'discovery-existing-'));
    await mkdir(join(capabilitiesDir, 'member.read-account-balance'));
    await writeFile(join(capabilitiesDir, ARTIFACT), '{}', 'utf8');

    const run = await discover(createScriptedReasoner(READ_FLOW), { capabilitiesDir });

    expect(expectStatus(run.result, 'failed')).toMatchObject({ reason: 'artifact_exists' });
    expect(await readFile(join(capabilitiesDir, ARTIFACT), 'utf8')).toBe('{}');
  });
});
