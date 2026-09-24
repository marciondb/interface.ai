import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromCapabilityFile } from '../../../src/adapters/capability-file';
import type { Capability } from '../../../src/models/capability';
import { runDiscovery, type DiscoveryHarnessRun } from '../../support/discovery-harness';
import { startFixture, type FixtureHandle } from '../../support/fixture';
import { createHumanActor, type ActorContext } from '../../support/human-actor';
import { runReplay } from '../../support/replay-harness';
import { createScriptedReasoner, READ_FLOW, type ScriptedStep } from '../../support/scripted-reasoner';

// The read flow up to the balance, without finishing.
const TO_BALANCE = READ_FLOW.slice(0, 5);
const FINISH: ScriptedStep = { verb: 'finish', argument: 'read the balance' };

async function clickCloseAccount({ page }: ActorContext): Promise<void> {
  const frame = page.frame({ name: 'content' });
  if (frame === null) throw new Error('no content frame');
  await frame.click('input[value="Close Account"]');
}

function humanDoesIt() {
  return createHumanActor([{ command: 'take' }, { act: clickCloseAccount }, { command: 'resume' }]);
}

async function events(run: DiscoveryHarnessRun): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(run.evidenceRoot, run.result.runId, 'run.jsonl'), 'utf8');
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function published(run: DiscoveryHarnessRun): Promise<Capability> {
  const loaded = fromCapabilityFile(JSON.parse(await readFile(join(run.capabilitiesDir, 'member.read-account-balance', '1.0.1.json'), 'utf8')));
  if (!loaded.ok) throw new Error(loaded.issues.join('; '));
  return loaded.capability;
}

describe('discovery with a human handoff', { timeout: 60_000 }, () => {
  let fixture: FixtureHandle | undefined;

  beforeAll(async () => {
    fixture = await startFixture();
  }, 30_000);

  afterAll(async () => {
    await fixture?.stop();
  });

  it('hands a blocked risky action to the human and publishes it as a risky step that replay hands over again', async () => {
    if (fixture === undefined) throw new Error('fixture not started');
    const operator = humanDoesIt();
    const reasoner = createScriptedReasoner([...TO_BALANCE, { verb: 'click', find: { role: 'button', name: 'Close Account' } }, FINISH]);

    const run = await runDiscovery(fixture, reasoner, { operator });

    expect(operator.errors).toEqual([]);
    expect(run.result).toMatchObject({ status: 'succeeded', outputs: { balance: '4,812.37' } });
    expect(run.result.interventions).toHaveLength(1);
    expect(run.escalations).toMatchObject([{ reason: 'risky_action', stepId: 'step-6', mode: 'discovery' }]);
    expect(run.driverCalls.filter((action) => action.kind === 'click')).toHaveLength(3);
    const recorded = await events(run);
    expect(recorded.filter((event) => event.type === 'policy' && event.stepId === 'step-6')).toMatchObject([{ decision: 'requires_human' }]);
    expect(recorded.filter((event) => event.type === 'handoff_human_action').map((event) => (event.action as { kind: string }).kind)).toEqual([
      'click',
      'navigation',
    ]);
    // The model's next observation is the page the human left.
    expect(JSON.stringify(reasoner.inputs.at(-1)?.observation)).toContain('Account closure has been submitted');

    const capability = await published(run);
    expect(capability.steps.at(-1)).toMatchObject({
      id: 'click-close-account',
      action: { kind: 'click', target: 'content.closeAccount' },
      risk: 'risky',
      checkpoint: { kind: 'text_visible', frame: 'content' },
    });
    expect(capability.targets['content.closeAccount']?.candidates).toEqual([{ strategy: 'role', role: 'button', name: 'Close Account' }]);

    const replayOperator = humanDoesIt();
    const replayed = await runReplay(fixture, { memberId: '10002', accountType: 'Savings' }, {
      capability: 'member.read-account-balance',
      capabilitiesDir: run.capabilitiesDir,
      operator: replayOperator,
    });
    expect(replayOperator.errors).toEqual([]);
    expect(replayed.result).toMatchObject({ status: 'succeeded', outputs: { balance: '3,100.55' } });
    expect(replayed.result.interventions).toHaveLength(1);
    expect(replayed.driverCalls.filter((call) => call.stepId === 'click-close-account')).toEqual([]);
  });

  it('lets the human unblock a model that asked for help and records what they did as theirs', async () => {
    if (fixture === undefined) throw new Error('fixture not started');
    const operator = humanDoesIt();
    const reasoner = createScriptedReasoner([...TO_BALANCE, { verb: 'request_help', argument: 'closing needs a person' }, FINISH]);

    const run = await runDiscovery(fixture, reasoner, { operator });

    expect(run.result.status).toBe('succeeded');
    expect(run.escalations).toMatchObject([{ reason: 'help_requested', message: 'closing needs a person' }]);
    expect((await published(run)).steps.map((step) => [step.id, step.risk])).toEqual([
      ['click-member-lookup', 'safe'],
      ['fill-member-id', 'safe'],
      ['click-search', 'safe'],
      ['click-name', 'safe'],
      ['read-balance', 'safe'],
      ['click-close-account', 'risky'],
    ]);
  });

  it('tells the model the human declined when they resume without changing the page', async () => {
    if (fixture === undefined) throw new Error('fixture not started');
    const operator = createHumanActor([{ command: 'take' }, { command: 'resume' }]);
    const reasoner = createScriptedReasoner([...TO_BALANCE, { verb: 'click', find: { role: 'button', name: 'Close Account' } }, FINISH]);

    const run = await runDiscovery(fixture, reasoner, { operator });

    expect(run.result.status).toBe('succeeded');
    expect(reasoner.inputs.at(-1)?.feedback).toMatch(/^a human took over and handed the screen back unchanged/);
    expect((await published(run)).steps.map((step) => step.risk)).not.toContain('risky');
  });
});
