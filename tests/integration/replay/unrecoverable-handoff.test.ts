import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readEvents } from '../../support/evidence';
import { startFixture, type FixtureHandle } from '../../support/fixture';
import { createHumanActor, type ActorContext, type HumanActor } from '../../support/human-actor';
import { referenceCapabilities, runReplay, type HarnessRun } from '../../support/replay-harness';

const MARIA = { memberId: '10001', accountType: 'Savings' };

// Requirement §3.6: a replay that hits a condition it cannot recover from asks a human.
describe('replay handing an unrecoverable step to a human', { timeout: 60_000 }, () => {
  let fixture: FixtureHandle | undefined;
  let capabilitiesDir = '';

  beforeAll(async () => {
    fixture = await startFixture();
    capabilitiesDir = await referenceCapabilities();
  }, 30_000);

  afterAll(async () => {
    await fixture?.stop();
  });

  // The Search button is gone (element_missing): the operator opens the results another way.
  async function openResultsByAddress({ page }: ActorContext): Promise<void> {
    if (fixture === undefined) throw new Error('fixture not started');
    const frame = page.frame({ name: 'content' });
    if (frame === null) throw new Error('no content frame');
    await frame.goto(`${fixture.baseUrl}/member/results?memberId=${MARIA.memberId}`);
  }

  async function withoutSearchButton(operator?: HumanActor): Promise<HarnessRun> {
    if (fixture === undefined) throw new Error('fixture not started');
    const run = await runReplay(fixture, MARIA, {
      capabilitiesDir,
      arm: { stepId: 'open-member-lookup', kind: 'element_missing' },
      ...(operator === undefined ? {} : { operator }),
    });
    expect(operator?.errors ?? []).toEqual([]);
    return run;
  }

  it('lets the operator get past a missing target, verifies the step checkpoint and finishes the run', async () => {
    const run = await withoutSearchButton(createHumanActor([{ command: 'take' }, { act: openResultsByAddress }, { command: 'resume' }]));

    expect(run.result).toMatchObject({ status: 'succeeded', outputs: { balance: '4,812.37' } });
    expect(run.result.interventions).toHaveLength(1);
    const events = await readEvents(run);
    expect(events.find((event) => event.type === 'handoff_requested')).toMatchObject({
      stepId: 'submit-search',
      reason: 'unrecoverable',
      message: expect.stringMatching(/^step submit-search failed with target_not_found: /) as string,
    });
    expect(events.find((event) => event.type === 'checkpoint' && event.stepId === 'submit-search')).toMatchObject({ holds: true, performedBy: 'human' });
    expect(run.driverCalls.filter((call) => call.stepId === 'submit-search')).toEqual([]);
  });

  it('ends escalated when the operator aborts', async () => {
    const run = await withoutSearchButton(createHumanActor([{ command: 'take' }, { command: 'abort' }]));

    expect(run.result).toMatchObject({ status: 'escalated', reason: 'aborted', stepId: 'submit-search' });
  });

  it('still fails with target_not_found without an operator window', async () => {
    const run = await withoutSearchButton();

    expect(run.result).toMatchObject({ status: 'failed', failure: { stepId: 'submit-search', code: 'target_not_found' }, interventions: [] });
  });
});
