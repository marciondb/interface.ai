import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Frame, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEscalationController } from '../../../src/controllers/escalation';
import { createFsRecorder } from '../../../src/diplomat/evidence/fs-recorder';
import { createActionGateway } from '../../../src/diplomat/gateway/action-gateway';
import type { GatewayOutcome } from '../../../src/diplomat/gateway/port';
import { createFixtureSessionProvider } from '../../../src/diplomat/session/fixture-login';
import { createPlaywrightDriver } from '../../../src/diplomat/surface/playwright-driver';
import { systemClock } from '../../../src/infrastructure/clock';
import type { ExecutionResult } from '../../../src/models/execution-result';
import { InterventionRequestSchema } from '../../../src/models/intervention';
import { at } from '../../support/at';
import { readEvents, runDir } from '../../support/evidence';
import { startFixture, type FixtureHandle } from '../../support/fixture';
import { createHumanActor, type ActorContext, type HumanActor } from '../../support/human-actor';
import { OPERATOR_ID, PASSWORD, runReplay, type HarnessRun } from '../../support/replay-harness';

const MARIA = { memberId: '10001' };
const CLOSE_ACCOUNT = 'input[value="Close Account"]';

function content(page: Page): Frame {
  const frame = page.frame({ name: 'content' });
  if (frame === null) throw new Error('no content frame');
  return frame;
}

async function clickCloseAccount({ page }: ActorContext): Promise<void> {
  await content(page).click(CLOSE_ACCOUNT);
}

async function sessionCookie(page: Page): Promise<string | undefined> {
  return (await page.context().cookies()).find((cookie) => cookie.name === 'ASP.NET_SessionId')?.value;
}

function escalated(result: ExecutionResult) {
  if (result.status !== 'escalated') throw new Error(`expected escalated, got ${JSON.stringify(result)}`);
  return result;
}

async function intervention(run: HarnessRun) {
  return InterventionRequestSchema.parse(JSON.parse(await readFile(join(runDir(run), 'intervention.json'), 'utf8')));
}

describe('human handoff of the live session', { timeout: 60_000 }, () => {
  let fixture: FixtureHandle | undefined;

  beforeAll(async () => {
    fixture = await startFixture();
  }, 30_000);

  afterAll(async () => {
    await fixture?.stop();
  });

  async function closeAccount(operator: HumanActor | undefined, handoffTtlMs?: number): Promise<HarnessRun> {
    if (fixture === undefined) throw new Error('fixture not started');
    const run = await runReplay(fixture, MARIA, {
      capability: 'member.close-account',
      ...(operator === undefined ? {} : { operator }),
      ...(handoffTtlMs === undefined ? {} : { handoffTtlMs }),
    });
    expect(operator?.errors ?? []).toEqual([]);
    return run;
  }

  it('(a) pauses at the risky step, lets the human do it in the same session, verifies and succeeds', async () => {
    const cookies: (string | undefined)[] = [];
    const operator = createHumanActor([
      { act: async ({ page }) => void cookies.push(await sessionCookie(page)) },
      { command: 'take' },
      { act: clickCloseAccount },
      { act: async ({ page }) => void cookies.push(await sessionCookie(page)) },
      { command: 'resume' },
    ]);

    const run = await closeAccount(operator);

    expect(run.result).toMatchObject({ status: 'succeeded', outputs: {} });
    expect(run.result.interventions).toEqual([expect.stringMatching(/^int-/)]);
    const interventionId = at(run.result.interventions, 0);
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toBeDefined();
    expect(cookies[1]).toBe(cookies[0]);
    expect(run.sessionsEstablished).toBe(1);
    expect(run.driverCalls.filter((call) => call.stepId === 'close-account')).toEqual([]);

    const events = await readEvents(run);
    expect(events.filter((event) => event.type === 'session').map((event) => event.event)).toEqual(['established', 'opened']);
    const handoff = events.filter((event) => String(event.type).startsWith('handoff_'));
    expect(handoff.map((event) => event.type)).toEqual([
      'handoff_requested',
      'handoff_taken',
      'handoff_human_action',
      'handoff_human_action',
      'handoff_resumed',
    ]);
    expect(handoff.every((event) => event.interventionId === interventionId && event.stepId === 'close-account')).toBe(true);
    expect(handoff[1]).toMatchObject({ by: OPERATOR_ID });
    expect(handoff[2]).toMatchObject({ action: { kind: 'click', target: { frame: 'content', role: 'button', name: 'Close Account' } } });
    expect(handoff[3]).toMatchObject({ action: { kind: 'navigation', frame: 'content', url: expect.stringMatching(/\/member\/danger\/close$/) as string } });
    expect(handoff[4]).toMatchObject({ by: OPERATOR_ID, actions: 2 });
    expect(events.find((event) => event.type === 'checkpoint' && event.stepId === 'close-account')).toMatchObject({ holds: true, performedBy: 'human' });
    expect(await intervention(run)).toMatchObject({ interventionId, mode: 'replay', capability: 'member.close-account@1.0.0', reason: 'risky_action' });
    expect(operator.printed()).toContain(`Human intervention requested: ${interventionId}`);
  });

  it('(b) refuses automation actions while the human holds control, leaving the page as it is', async () => {
    let refused: GatewayOutcome | undefined;
    let frameUrl = '';
    const operator = createHumanActor([
      { command: 'take' },
      {
        act: async ({ page, gateway }) => {
          const resolution = await gateway.resolve({ frame: 'content', candidates: [{ strategy: 'role', role: 'button', name: 'Close Account' }] });
          if (resolution.status !== 'resolved') throw new Error('Close Account did not resolve');
          const click = { kind: 'click', ref: resolution.ref } as const;
          refused = await gateway.perform({ stepId: 'intruder', purpose: 'step', action: click, timeoutMs: 1_000 });
          frameUrl = content(page).url();
        },
      },
      { act: clickCloseAccount },
      { command: 'resume' },
    ]);

    const run = await closeAccount(operator);

    expect(refused).toEqual({ status: 'denied', reason: 'control_owned_by_human' });
    expect(frameUrl).toMatch(/\/member\/detail\?memberId=10001$/);
    expect(run.driverCalls.filter((call) => call.stepId === 'intruder')).toEqual([]);
    expect(run.result.status).toBe('succeeded');
  });

  it('(c) keeps control with the human when the checkpoint does not hold yet', async () => {
    const operator = createHumanActor([{ command: 'take' }, { command: 'resume' }, { act: clickCloseAccount }, { command: 'resume' }]);

    const run = await closeAccount(operator);

    expect(run.result.status).toBe('succeeded');
    const events = await readEvents(run);
    expect(events.filter((event) => String(event.type).startsWith('handoff_')).map((event) => event.type)).toEqual([
      'handoff_requested',
      'handoff_taken',
      'handoff_verify_failed',
      'handoff_human_action',
      'handoff_human_action',
      'handoff_resumed',
    ]);
    expect(events.find((event) => event.type === 'handoff_verify_failed')).toMatchObject({
      expected: expect.stringMatching(/^text "Account closure has been submitted" visible/) as string,
    });
    expect(events.filter((event) => event.type === 'checkpoint' && event.stepId === 'close-account').map((event) => event.holds)).toEqual([false, true]);
    expect(operator.printed()).toContain('Not done yet');
  });

  it('(d) records human clicks, masked inputs, navigations and dialog answers on a direct handoff', async () => {
    if (fixture === undefined) throw new Error('fixture not started');
    const evidenceRoot = await mkdtemp(join(tmpdir(), 'handoff-evidence-'));
    const driver = createPlaywrightDriver();
    const evidence = createFsRecorder({ root: evidenceRoot, secrets: [PASSWORD] });
    let accepted: unknown;
    const operator = createHumanActor(
      [
        { command: 'take' },
        {
          act: async ({ page }) => {
            const frame = content(page);
            await frame.fill('input[name="ctl00$ContentPlaceHolder1$txtMemberId"]', '10001');
            await frame.click('input[value="Search"]');
            await frame.waitForURL(/\/member\/results/);
            accepted = await frame.evaluate('confirm("Leave the results page?")');
          },
        },
        { command: 'resume' },
      ],
      ['accept'],
    );
    const escalation = createEscalationController(
      { surface: driver, broker: operator.broker, evidence, clock: systemClock },
      { ttlMs: 30_000, humanSurfaceAvailable: true, operatorId: OPERATOR_ID },
    );
    const policy = { allowedOrigins: [fixture.baseUrl], allowedRoutes: ['/', '/member/*'], allowedActions: ['click' as const, 'navigate' as const], risky: { routes: [], controlText: [] } };
    const gateway = createActionGateway({ driver, policy, controlOwner: escalation.owner });
    try {
      const run = await evidence.startRun({ mode: 'discovery', capabilityId: 'test.direct-handoff' });
      await gateway.open(`${fixture.baseUrl}/`, await createFixtureSessionProvider({ username: 'operator', password: PASSWORD }).establish(`${fixture.baseUrl}/`));
      operator.attach({ page: driver.page(), gateway });
      const shell = await gateway.observe();
      const lookup = shell.nodes.find((node) => node.role === 'link' && node.name === 'Member Lookup');
      await gateway.perform({ stepId: 'lookup', purpose: 'step', action: { kind: 'click', ref: lookup?.ref ?? '' }, timeoutMs: 2_000 });

      const outcome = await escalation.handOff({
        run,
        mode: 'discovery',
        goal: 'Look up member 10001',
        stepId: 'step-2',
        reason: 'help_requested',
        message: 'search for the member',
        async verify() {
          const observation = await gateway.observe();
          return observation.nodes.some((node) => node.role === 'link' && node.name === 'Maria Santos')
            ? { held: true }
            : { held: false, expected: 'the results', observed: 'no results' };
        },
      });

      expect(operator.errors).toEqual([]);
      expect(outcome).toMatchObject({ status: 'resumed', by: OPERATOR_ID });
      expect(escalation.owner()).toBe('automation');
      expect(accepted).toBe(true);
      const lines = (await readFile(join(run.dir, 'run.jsonl'), 'utf8')).trim().split('\n');
      const actions = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((event) => event.type === 'handoff_human_action');
      expect(actions.map((event) => (event.action as { kind: string }).kind)).toEqual(['input', 'click', 'navigation', 'dialog']);
      expect(actions[0]).toMatchObject({ action: { value: '[redacted]', target: { nameAttr: 'ctl00$ContentPlaceHolder1$txtMemberId' } } });
      expect(actions[1]).toMatchObject({ action: { target: { role: 'button', name: 'Search' } } });
      expect(actions[2]).toMatchObject({ action: { url: `${fixture.baseUrl}/member/results` } });
      expect(actions[3]).toMatchObject({ action: { message: 'Leave the results page?', decision: 'accept' } });
      expect(JSON.stringify(actions)).not.toContain('10001');
      const request = InterventionRequestSchema.parse(JSON.parse(await readFile(join(run.dir, 'intervention.json'), 'utf8')));
      expect(request).toMatchObject({
        mode: 'discovery',
        goal: 'Look up member 10001',
        reason: 'help_requested',
      });
    } finally {
      operator.broker.close();
      await driver.close();
    }
  });

  it('(e) ends escalated when nobody answers before the TTL, with the whole intervention request written', async () => {
    const operator = createHumanActor([]);

    const run = await closeAccount(operator, 300);

    const result = escalated(run.result);
    expect(result).toMatchObject({ reason: 'ttl_expired', stepId: 'close-account', message: expect.stringMatching(/\(handoff ttl_expired\)$/) as string });
    expect(result.interventions).toEqual([result.interventionId]);
    const request = await intervention(run);
    expect(request).toMatchObject({
      interventionId: result.interventionId,
      runId: result.runId,
      mode: 'replay',
      capability: 'member.close-account@1.0.0',
      stepId: 'close-account',
      reason: 'risky_action',
      url: expect.stringMatching(/\/member\/detail\?memberId=/) as string,
    });
    expect(Date.parse(request.expiresAt) - Date.parse(request.requestedAt)).toBe(300);
    expect(existsSync(join(runDir(run), request.screenshot ?? 'missing'))).toBe(true);
    const events = await readEvents(run);
    expect(events.find((event) => event.type === 'handoff_aborted')).toMatchObject({ cause: 'ttl_expired' });
  });

  it('(f) ends escalated when the operator closes the window', async () => {
    const operator = createHumanActor([{ command: 'take' }, { act: ({ page }) => page.close() }]);

    const run = await closeAccount(operator);

    expect(escalated(run.result)).toMatchObject({ reason: 'surface_closed', stepId: 'close-account' });
    const events = await readEvents(run);
    expect(events.find((event) => event.type === 'handoff_aborted')).toMatchObject({ cause: 'surface_closed' });
  });

  it('(g) ends escalated at once without an operator surface, still writing the request', async () => {
    const run = await closeAccount(undefined);

    const result = escalated(run.result);
    expect(result).toMatchObject({ reason: 'no_operator_surface', stepId: 'close-account' });
    expect(await intervention(run)).toMatchObject({ interventionId: result.interventionId, reason: 'risky_action' });
    expect(run.result.durationMs).toBeLessThan(10_000);
  });
});
