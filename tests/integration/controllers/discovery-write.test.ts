import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromCapabilityFile } from '../../../src/adapters/capability-file';
import { runDiscovery, SUB_ACCOUNT_REQUEST, type DiscoveryHarnessRun } from '../../support/discovery-harness';
import { startFixture, type FixtureHandle } from '../../support/fixture';
import type { HumanActor } from '../../support/human-actor';
import { operatorAborts, operatorConfirms, operatorDeclines } from '../../support/scripted-operator';
import { createScriptedReasoner, WRITE_FLOW, WRITE_FLOW_TO_CONFIRM, type ScriptedReasoner, type ScriptedStep } from '../../support/scripted-reasoner';

const ARTIFACT = ['member.open-sub-account', '1.0.0.json'];

async function events(run: DiscoveryHarnessRun): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(run.evidenceRoot, run.result.runId, 'run.jsonl'), 'utf8');
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('discovery of the write flow with a human at Confirm', { timeout: 60_000 }, () => {
  let fixture: FixtureHandle | undefined;

  beforeAll(async () => {
    fixture = await startFixture();
  }, 30_000);

  afterAll(async () => {
    await fixture?.stop();
  });

  async function discover(script: readonly ScriptedStep[], operator: HumanActor): Promise<{ run: DiscoveryHarnessRun; reasoner: ScriptedReasoner }> {
    if (fixture === undefined) throw new Error('fixture not started');
    const reasoner = createScriptedReasoner(script);
    const run = await runDiscovery(fixture, reasoner, { requestPath: SUB_ACCOUNT_REQUEST, operator });
    expect(operator.errors).toEqual([]);
    return { run, reasoner };
  }

  it('publishes an artifact whose Confirm, done by the human, is its one risky step', async () => {
    const { run } = await discover(WRITE_FLOW, operatorConfirms());

    expect(run.result).toMatchObject({ status: 'succeeded', outputs: { accountNumber: '10001MMRAIN025000' } });
    expect(run.escalations).toMatchObject([{ reason: 'risky_action', stepId: 'step-10', mode: 'discovery' }]);
    // Member Lookup, Search, Maria Santos, Open Sub-Account and Continue: never Confirm.
    expect(run.driverCalls.filter((action) => action.kind === 'click')).toHaveLength(5);
    const recorded = await events(run);
    expect(recorded.filter((event) => event.type === 'handoff_human_action').map((event) => (event.action as { kind: string }).kind)).toEqual([
      'click',
      'dialog',
      'navigation',
    ]);
    expect(recorded.find((event) => event.type === 'handoff_human_action' && (event.action as { kind: string }).kind === 'dialog')).toMatchObject({
      action: { message: 'Submit this sub-account request?', decision: 'accept' },
    });

    const loaded = fromCapabilityFile(JSON.parse(await readFile(join(run.capabilitiesDir, ...ARTIFACT), 'utf8')));
    if (!loaded.ok) throw new Error(loaded.issues.join('; '));
    const { steps, targets } = loaded.capability;
    expect(steps.filter((step) => step.risk === 'risky').map((step) => step.id)).toEqual(['click-confirm']);
    expect(steps.map((step) => step.id)).toEqual([
      'click-member-lookup',
      'fill-member-id',
      'click-search',
      'click-name',
      'click-open-sub-account',
      'select-account-type',
      'fill-nickname',
      'fill-initial-deposit',
      'click-continue',
      'click-confirm',
      'read-account-number',
    ]);
    expect(targets['content.newAccountNumber'].candidates[0]).toEqual({ strategy: 'label', text: 'New Account Number:' });
  });

  it('records no step and tells the model when the human hands back without confirming', async () => {
    const operator = operatorDeclines();
    const { run, reasoner } = await discover([...WRITE_FLOW_TO_CONFIRM, { verb: 'finish', argument: 'done' }], operator);

    const afterHandoff = reasoner.inputs[WRITE_FLOW_TO_CONFIRM.length];
    expect(afterHandoff.feedback).toMatch(/^a human took over and handed the screen back unchanged/);
    expect(JSON.stringify(afterHandoff.observation)).toContain('Review Sub-Account Request');
    expect(run.result).toMatchObject({ status: 'failed', reason: 'reasoner_exhausted' });
    expect(existsSync(join(run.capabilitiesDir, ...ARTIFACT))).toBe(false);
  });

  it('ends escalated without an artifact when the human aborts', async () => {
    const { run } = await discover(WRITE_FLOW, operatorAborts());

    expect(run.result).toMatchObject({ status: 'escalated', reason: 'aborted', stepId: 'step-10' });
    expect(existsSync(join(run.capabilitiesDir, ...ARTIFACT))).toBe(false);
  });
});
