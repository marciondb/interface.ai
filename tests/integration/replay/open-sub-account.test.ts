import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDiscovery, SUB_ACCOUNT_REQUEST } from '../../support/discovery-harness';
import { evidenceText, readEvents } from '../../support/evidence';
import { startFixture, type FixtureHandle } from '../../support/fixture';
import type { HumanActor } from '../../support/human-actor';
import { runReplay, type HarnessRun } from '../../support/replay-harness';
import { operatorAborts, operatorConfirms, operatorConfirmsAndApproves, SUPERVISOR_CODE } from '../../support/scripted-operator';
import { createScriptedReasoner, WRITE_FLOW } from '../../support/scripted-reasoner';

const HOLIDAY = { memberId: '10002', accountType: 'Holiday Club', nickname: 'Vacation', initialDeposit: '100.00' };

// Replays of an artifact discovered in the test itself (scripted model, scripted operator).
describe('replay of the discovered open-sub-account artifact', { timeout: 60_000 }, () => {
  let fixture: FixtureHandle | undefined;
  let capabilitiesDir: string | undefined;

  beforeAll(async () => {
    fixture = await startFixture();
    const discovery = await runDiscovery(fixture, createScriptedReasoner(WRITE_FLOW), { requestPath: SUB_ACCOUNT_REQUEST, operator: operatorConfirms() });
    if (discovery.result.status !== 'succeeded') throw new Error(`discovery did not succeed: ${JSON.stringify(discovery.result)}`);
    capabilitiesDir = discovery.capabilitiesDir;
  }, 60_000);

  afterAll(async () => {
    await fixture?.stop();
  });

  async function open(inputs: Record<string, string>, operator?: HumanActor): Promise<HarnessRun> {
    if (fixture === undefined || capabilitiesDir === undefined) throw new Error('setup did not complete');
    const run = await runReplay(fixture, inputs, {
      capability: 'member.open-sub-account',
      capabilitiesDir,
      ...(operator === undefined ? {} : { operator }),
    });
    expect(operator?.errors ?? []).toEqual([]);
    return run;
  }

  it('hands Confirm to the human and reads the new account number once its checkpoint holds', async () => {
    const run = await open(HOLIDAY, operatorConfirms());

    expect(run.result).toMatchObject({ status: 'succeeded', outputs: { accountNumber: '10002HCVACA010000' } });
    expect(run.result.interventions).toHaveLength(1);
    expect(run.driverCalls.filter((call) => call.stepId === 'click-confirm')).toEqual([]);
    const events = await readEvents(run);
    expect(events.filter((event) => event.type === 'handoff_human_action').map((event) => (event.action as { kind: string }).kind)).toEqual([
      'click',
      'dialog',
      'navigation',
    ]);
    expect(events.find((event) => event.type === 'checkpoint' && event.stepId === 'click-confirm')).toMatchObject({ holds: true, performedBy: 'human' });
  });

  it('reports a deposit below the minimum as a business outcome without asking anyone', async () => {
    const run = await open({ ...HOLIDAY, initialDeposit: '10.00' });

    expect(run.result).toMatchObject({ status: 'business_outcome', outcome: 'invalid_initial_deposit', interventions: [] });
  });

  it('reports a nickname the application rejects as a business outcome', async () => {
    const run = await open({ ...HOLIDAY, nickname: 'Bad!' });

    expect(run.result).toMatchObject({ status: 'business_outcome', outcome: 'invalid_nickname', interventions: [] });
  });

  it('ends escalated when the human aborts at Confirm', async () => {
    const run = await open(HOLIDAY, operatorAborts());

    expect(run.result).toMatchObject({ status: 'escalated', reason: 'aborted', stepId: 'click-confirm' });
  });

  it('keeps the human in control through supervisor approval, whose code never reaches the evidence', async () => {
    const run = await open({ memberId: '10001', accountType: 'Savings', nickname: 'Big Save', initialDeposit: '15000.00' }, operatorConfirmsAndApproves());

    expect(run.result).toMatchObject({ status: 'succeeded', outputs: { accountNumber: '10001SVBIGS1500000' } });
    expect(run.result.interventions).toHaveLength(1);
    const events = await readEvents(run);
    expect(events.filter((event) => event.type === 'handoff_verify_failed')).toHaveLength(1);
    expect(await evidenceText(run)).not.toContain(SUPERVISOR_CODE);
  });
});
