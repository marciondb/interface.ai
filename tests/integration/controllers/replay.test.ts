import { describe, expect, it } from 'vitest';
import { pollUntil } from '../../../src/controllers/poll';
import { replay } from '../../../src/controllers/replay';
import type { SessionErrorCode } from '../../../src/diplomat/session/port';
import { CapabilitySchema, type Capability } from '../../../src/models/capability';
import { ExecutionResultSchema, type EscalationReason, type ExecutionResult } from '../../../src/models/execution-result';
import {
  createFakeClock,
  createFakeEscalation,
  createFakeEvidence,
  createFakeGateway,
  createFakeSession,
  createFakeStore,
  FAKE_ORIGIN,
  fakeTarget,
  hide,
  show,
  SIGN_IN_URL,
  changes,
  surfaceFault,
  type Effect,
  type FakeGatewayOptions,
  type FakePage,
} from '../../support/fakes';

const MEMBER = '10001';
const BALANCE = '4,812.37';
const STEP_TIMEOUT_MS = 1_000;

const base = {
  preconditions: [{ kind: 'authenticated_session' }],
  inputs: { memberId: { type: 'string', description: 'Member id', pattern: '^[0-9]+$', sensitivity: 'internal' } },
  provenance: { method: 'hand_written', createdAt: '2026-09-24T00:00:00Z' },
};

// Look up a member and read their balance, with a business outcome and a declared recovery.
const READ_BALANCE: Capability = CapabilitySchema.parse({
  ...base,
  capability: { id: 'member.read-balance', version: '1.0.0', description: 'Read a balance', app: { product: 'fake', surface: 'web' } },
  outputs: { balance: { type: 'string', description: 'Balance', sensitivity: 'financial' } },
  targets: Object.fromEntries(['menu.lookup', 'lookup.memberId', 'lookup.search', 'detail.balance', 'banner.continue'].map((name) => [name, fakeTarget(name)])),
  steps: [
    { id: 'open-lookup', action: { kind: 'click', target: 'menu.lookup' }, risk: 'safe', checkpoint: { kind: 'target_visible', target: 'lookup.memberId' } },
    {
      id: 'enter-member',
      action: { kind: 'fill', target: 'lookup.memberId', value: '{{inputs.memberId}}' },
      risk: 'safe',
      checkpoint: { kind: 'value_equals', target: 'lookup.memberId', value: '{{inputs.memberId}}' },
    },
    { id: 'search', action: { kind: 'click', target: 'lookup.search' }, risk: 'safe', checkpoint: { kind: 'target_visible', target: 'detail.balance' } },
    {
      id: 'read-balance',
      action: { kind: 'read', target: 'detail.balance', output: 'balance' },
      risk: 'safe',
      checkpoint: { kind: 'value_matches', target: 'detail.balance', pattern: '^[0-9,]+\\.[0-9]{2}$' },
    },
  ],
  outcomes: [
    { id: 'member_not_found', kind: 'business', when: { kind: 'text_visible', text: 'No records found.' } },
    { id: 'maintenance', kind: 'recoverable', when: { kind: 'text_visible', text: 'Click Continue to proceed' }, recover: { kind: 'click', target: 'banner.continue' } },
  ],
});

// Open a form, confirm it (risky: a human does it), then close the confirmation.
const CONFIRM: Capability = CapabilitySchema.parse({
  ...base,
  capability: { id: 'member.confirm', version: '1.0.0', description: 'Confirm a request', app: { product: 'fake', surface: 'web' } },
  outputs: {},
  targets: Object.fromEntries(['menu.form', 'form.confirm', 'done.close'].map((name) => [name, fakeTarget(name)])),
  steps: [
    { id: 'open-form', action: { kind: 'click', target: 'menu.form' }, risk: 'safe', checkpoint: { kind: 'target_visible', target: 'form.confirm' } },
    { id: 'confirm', action: { kind: 'click', target: 'form.confirm' }, risk: 'risky', checkpoint: { kind: 'text_visible', text: 'Request confirmed' } },
    { id: 'close', action: { kind: 'click', target: 'done.close' }, risk: 'safe', checkpoint: { kind: 'text_visible', text: 'Closed' } },
  ],
  outcomes: [],
});

function showsResults(page: FakePage): void {
  hide(page, 'lookup.memberId', 'lookup.search');
  page.elements.set('detail.balance', { count: 1, value: BALANCE });
}

// The page as the lookup flow changes it when everything goes well.
const LOOKUP: Readonly<Record<string, Effect>> = {
  'open-lookup': changes((page) => {
    show(page, 'lookup.memberId', 'lookup.search');
  }),
  search: changes(showsResults),
};

// The lookup page without its Search button.
const onlyMemberId = changes((page) => {
  show(page, 'lookup.memberId');
});

const CONFIRM_FLOW: Readonly<Record<string, Effect>> = {
  'open-form': changes((page) => {
    show(page, 'form.confirm');
  }),
  close: (page) => void (page.texts = ['Closed']),
};

// The human confirms on the review page.
function humanConfirms(page: FakePage): void {
  hide(page, 'form.confirm');
  show(page, 'done.close');
  page.texts = ['Request confirmed'];
}

type Setup = {
  readonly capability?: Capability;
  readonly gateway?: FakeGatewayOptions;
  readonly effects?: Readonly<Record<string, Effect>>;
  readonly sessionFails?: SessionErrorCode;
  // An operator window, with what the human does on the page once handed the session.
  readonly operator?: { readonly human?: (page: FakePage) => void; readonly abort?: EscalationReason };
};

async function run(setup: Setup = {}) {
  const capability = setup.capability ?? READ_BALANCE;
  const clock = createFakeClock();
  const evidence = createFakeEvidence();
  const session = createFakeSession(setup.sessionFails);
  const gateway = createFakeGateway({
    visible: capability === READ_BALANCE ? ['menu.lookup'] : ['menu.form'],
    ...setup.gateway,
    effects: setup.effects ?? (capability === READ_BALANCE ? LOOKUP : CONFIRM_FLOW),
  });
  const { operator } = setup;
  const escalation = createFakeEscalation(
    operator === undefined
      ? { humanSurfaceAvailable: false }
      : { humanSurfaceAvailable: true, human: () => operator.human?.(gateway.page), ...(operator.abort === undefined ? {} : { abort: operator.abort }) },
  );
  const result = await replay(
    { store: createFakeStore(capability), session, gateway, evidence, escalation, clock },
    { capabilityId: capability.capability.id, major: 1, inputs: { memberId: MEMBER }, targetUrl: `${FAKE_ORIGIN}/` },
    { stepTimeoutMs: STEP_TIMEOUT_MS, pollIntervalMs: 250 },
  );
  // Every run ends exactly once, with a valid result.
  expect(evidence.results).toEqual([result]);
  expect(ExecutionResultSchema.parse(result)).toEqual(result);
  return { result, clock, evidence, session, escalation, gateway };
}

function failure(result: ExecutionResult) {
  if (result.status !== 'failed') throw new Error(`expected failed, got ${JSON.stringify(result)}`);
  return result.failure;
}

describe('replay controller with fakes', () => {
  it('succeeds, masking the member id and the balance in every screenshot it would take', async () => {
    const { result, evidence, clock } = await run();

    expect(result).toMatchObject({ status: 'succeeded', outputs: { balance: BALANCE }, recoveries: [], interventions: [] });
    expect(evidence.protected.map(({ value }) => value)).toEqual([MEMBER, BALANCE]);
    expect(evidence.captures).toEqual([]);
    expect(clock.sleeps).toEqual([]);
  });

  it('returns a business outcome as soon as it shows', async () => {
    const { result, clock } = await run({ effects: { ...LOOKUP, search: (page) => void (page.texts = ['No records found.']) } });

    expect(result).toMatchObject({ status: 'business_outcome', outcome: 'member_not_found', details: { stepId: 'search' } });
    expect(clock.sleeps).toEqual([]);
  });

  it('applies the declared recovery, then succeeds', async () => {
    let maintenance = true;
    const openLookup: Effect = (page, request) => {
      if (request.purpose === 'recovery') {
        page.texts = [];
        hide(page, 'banner.continue');
      } else if (maintenance) {
        maintenance = false;
        page.texts = ['Click Continue to proceed'];
        show(page, 'banner.continue');
      } else {
        show(page, 'lookup.memberId', 'lookup.search');
      }
      return undefined;
    };

    const { result } = await run({ effects: { ...LOOKUP, 'open-lookup': openLookup } });

    expect(result).toMatchObject({
      status: 'succeeded',
      recoveries: [{ stepId: 'open-lookup', condition: 'outcome', outcomeId: 'maintenance', response: 'declared_recovery', attempt: 1 }],
    });
  });

  it('fails with recovery_exhausted when the recovery never clears the condition', async () => {
    const stuck: Effect = (page) => {
      page.texts = ['Click Continue to proceed'];
      show(page, 'banner.continue');
      return undefined;
    };

    const { result } = await run({ effects: { ...LOOKUP, 'open-lookup': stuck } });

    expect(failure(result)).toMatchObject({ stepId: 'open-lookup', code: 'recovery_exhausted' });
    expect(result.recoveries.map((recovery) => recovery.condition)).toEqual(['outcome', 'outcome']);
  });

  it('fails with target_not_found after the step timeout, photographing the page with the protected values masked', async () => {
    const { result, clock, gateway, evidence } = await run({ effects: { ...LOOKUP, 'open-lookup': onlyMemberId } });

    expect(failure(result)).toMatchObject({
      stepId: 'search',
      code: 'target_not_found',
      expected: 'lookup.search matches exactly one element',
      evidence: expect.stringMatching(/screenshots\/1-search\.png$/) as string,
    });
    expect(clock.sleeps).toEqual([250, 250, 250, 250]);
    expect(gateway.screenshots).toEqual([{ maskTexts: [MEMBER] }]);
    expect(evidence.captures).toEqual([{ stepId: 'search', screenshot: true, snapshot: true }]);
  });

  it('never photographs the sign-in page', async () => {
    const effects = { ...LOOKUP, search: (page: FakePage) => void (page.url = SIGN_IN_URL) };

    const { result, gateway } = await run({ effects });

    expect(failure(result)).toMatchObject({ stepId: 'search', code: 'session_expired' });
    expect(gateway.screenshots).toEqual([]);
  });

  it('fails with checkpoint_failed when the step does nothing', async () => {
    const { result } = await run({ effects: { ...LOOKUP, search: () => undefined } });

    expect(failure(result)).toMatchObject({ stepId: 'search', code: 'checkpoint_failed', expected: 'detail.balance matches exactly one element' });
  });

  it('reports a surface failure as driver_error at the step it happened', async () => {
    const { result } = await run({
      effects: {
        ...LOOKUP,
        search: () => {
          throw surfaceFault('unknown_ref', 'e9 is not in the latest observation');
        },
      },
    });

    expect(failure(result)).toMatchObject({ stepId: 'search', code: 'driver_error', observed: 'surface unknown_ref: e9 is not in the latest observation' });
  });

  it('retries a page that does not become readable in time as a timeout', async () => {
    let stalls = 1;
    const onObserve = () => {
      if (stalls-- > 0) throw surfaceFault('timeout', 'the page did not load within 5000 ms');
    };

    const { result } = await run({ gateway: { onObserve } });

    expect(result).toMatchObject({ status: 'succeeded', recoveries: [{ stepId: 'open-lookup', condition: 'timeout', response: 'retry', attempt: 1 }] });
  });

  it('fails with timeout at the step once both retries are spent', async () => {
    const onObserve = () => {
      throw surfaceFault('timeout', 'the page did not load within 5000 ms');
    };

    const { result } = await run({ gateway: { onObserve } });

    expect(failure(result)).toMatchObject({ stepId: 'open-lookup', code: 'timeout' });
    expect(result.recoveries.map((recovery) => recovery.condition === 'timeout' && recovery.attempt)).toEqual([1, 2]);
  });

  it('fails the preconditions when signing in fails, before any action', async () => {
    const { result, gateway } = await run({ sessionFails: 'invalid_credentials' });

    expect(failure(result)).toMatchObject({ stepId: 'preconditions', code: 'precondition_failed', observed: 'sign-in failed: invalid_credentials' });
    expect(gateway.performed).toEqual([]);
  });

  it('fails when an action lands outside the policy', async () => {
    const landed: Effect = () => ({ status: 'landed_outside_policy', reason: 'landed_outside_allowlist', landedAt: 'http://elsewhere.test/' });

    const { result } = await run({ effects: { ...LOOKUP, search: landed } });

    expect(failure(result)).toMatchObject({ stepId: 'search', code: 'policy_denied', observed: 'landed_outside_allowlist at http://elsewhere.test/' });
  });

  it('re-authenticates and restarts when an action lands on the sign-in page', async () => {
    let expire = true;
    const search: Effect = (page) => {
      if (!expire) {
        showsResults(page);
        return undefined;
      }
      expire = false;
      page.url = SIGN_IN_URL;
      return { status: 'landed_outside_policy', reason: 'landed_outside_allowlist', landedAt: SIGN_IN_URL };
    };

    const { result, session, evidence } = await run({ effects: { ...LOOKUP, search } });

    expect(result).toMatchObject({ status: 'succeeded', recoveries: [{ stepId: 'search', condition: 'session_expired', response: 'reauthenticate', attempt: 1 }] });
    expect(session.established).toBe(2);
    expect(evidence.events.filter((event) => event.type === 'session').map((event) => event.event)).toEqual(['established', 'opened', 'reauthenticated', 'opened']);
  });

  it('ends escalated when a risky action needs a human and there is no operator window', async () => {
    const { result, escalation } = await run({ effects: { ...LOOKUP, search: () => ({ status: 'requires_human', reason: 'risky control text' }) } });

    expect(result).toMatchObject({ status: 'escalated', reason: 'no_operator_surface', stepId: 'search', interventions: ['int-1'] });
    expect(escalation.requests).toMatchObject([{ reason: 'risky_action', message: 'click on lookup.search needs a human: risky control text', maskTexts: [MEMBER] }]);
  });

  describe('a failure a human may get past (requirement §3.6)', () => {
    const noSearch: Readonly<Record<string, Effect>> = { ...LOOKUP, 'open-lookup': onlyMemberId };

    it('is handed to the operator, whose verified work lets the run go on', async () => {
      const { result, escalation } = await run({
        effects: noSearch,
        operator: { human: showsResults },
      });

      expect(result).toMatchObject({ status: 'succeeded', outputs: { balance: BALANCE }, interventions: ['int-1'] });
      expect(escalation.requests).toMatchObject([{ stepId: 'search', reason: 'unrecoverable', maskTexts: [MEMBER] }]);
      expect(escalation.requests[0]?.message).toMatch(/^step search failed with target_not_found: expected lookup.search matches exactly one element; observed/);
    });

    it('ends escalated when the operator aborts', async () => {
      const { result } = await run({ effects: noSearch, operator: { abort: 'aborted' } });

      expect(result).toMatchObject({ status: 'escalated', reason: 'aborted', stepId: 'search' });
      expect(result.status === 'escalated' && result.message).toMatch(/\(handoff aborted\)$/);
    });

    it('stays a failure without an operator window', async () => {
      const { result, escalation } = await run({ effects: noSearch });

      expect(failure(result)).toMatchObject({ code: 'target_not_found' });
      expect(escalation.requests).toEqual([]);
    });

    it('is not offered for a server error', async () => {
      const serverError: Effect = () => ({ status: 'done', navigations: [{ url: `${FAKE_ORIGIN}/search`, status: 500 }] });

      const { result, escalation } = await run({ effects: { ...LOOKUP, search: serverError }, operator: {} });

      expect(failure(result)).toMatchObject({ code: 'server_error' });
      expect(escalation.requests).toEqual([]);
    });

    it('lets a read capture its value from the page the human left', async () => {
      const blank: Effect = (page) => {
        showsResults(page);
        page.elements.set('detail.balance', { count: 1, value: 'loading' });
        return undefined;
      };

      const { result } = await run({
        effects: { ...LOOKUP, search: blank },
        operator: { human: showsResults },
      });

      expect(result).toMatchObject({ status: 'succeeded', outputs: { balance: BALANCE }, interventions: ['int-1'] });
    });
  });

  it('hands a risky step to the human and refuses to restart once it is done', async () => {
    const effects = { ...CONFIRM_FLOW, close: (page: FakePage) => void (page.url = SIGN_IN_URL) };

    const { result, session, escalation } = await run({
      capability: CONFIRM,
      effects,
      operator: { human: humanConfirms },
    });

    expect(failure(result)).toMatchObject({ stepId: 'close', code: 'session_expired' });
    expect(failure(result).observed).toContain('not restarted: a risky step is already done and a restart would repeat it');
    expect(session.established).toBe(1);
    expect(escalation.requests.map((request) => request.reason)).toEqual(['risky_action']);
  });

  it('completes the risky flow when the session holds', async () => {
    const { result } = await run({ capability: CONFIRM, operator: { human: humanConfirms } });

    expect(result).toMatchObject({ status: 'succeeded', interventions: ['int-1'] });
  });

  describe('an unexpected dialog', () => {
    const DIALOG = { type: 'alert', message: `Member ${MEMBER}: maintenance tonight` } as const;

    it('is recorded as a recovery when the step checkpoint still holds', async () => {
      const openLookup: Effect = (page) => {
        page.dialog = DIALOG;
        show(page, 'lookup.memberId', 'lookup.search');
        return undefined;
      };

      const { result } = await run({ effects: { ...LOOKUP, 'open-lookup': openLookup } });

      expect(result).toMatchObject({
        status: 'succeeded',
        recoveries: [{ stepId: 'open-lookup', condition: 'unexpected_dialog', response: 'dismissed', dialog: DIALOG }],
      });
    });

    it('is named in the failure when the checkpoint does not hold', async () => {
      const search: Effect = (page) => void (page.dialog = DIALOG);

      const { result } = await run({ effects: { ...LOOKUP, search } });

      expect(failure(result)).toMatchObject({ stepId: 'search', code: 'checkpoint_failed' });
      expect(failure(result).observed).toMatch(/; a alert dialog was dismissed: Member 10001: maintenance tonight$/);
      expect(result.recoveries).toEqual([]);
    });
  });

  it('rethrows a bug instead of reporting it as a driver error, without finishing the run', async () => {
    const evidence = createFakeEvidence();
    const buggy: Effect = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'ref')");
    };
    const gateway = createFakeGateway({ visible: ['menu.lookup'], effects: { ...LOOKUP, search: buggy } });

    const replayed = replay(
      {
        store: createFakeStore(READ_BALANCE),
        session: createFakeSession(),
        gateway,
        evidence,
        escalation: createFakeEscalation({ humanSurfaceAvailable: false }),
        clock: createFakeClock(),
      },
      { capabilityId: READ_BALANCE.capability.id, major: 1, inputs: { memberId: MEMBER }, targetUrl: `${FAKE_ORIGIN}/` },
      { stepTimeoutMs: STEP_TIMEOUT_MS },
    );

    await expect(replayed).rejects.toThrow(TypeError);
    expect(evidence.results).toEqual([]);
  });

  it('rethrows evidence that cannot be written instead of reporting a driver error', async () => {
    const evidence = createFakeEvidence();
    evidence.capture = () => Promise.reject(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }));

    const replayed = replay(
      {
        store: createFakeStore(READ_BALANCE),
        session: createFakeSession(),
        gateway: createFakeGateway({ visible: ['menu.lookup'], effects: { ...LOOKUP, search: () => undefined } }),
        evidence,
        escalation: createFakeEscalation({ humanSurfaceAvailable: false }),
        clock: createFakeClock(),
      },
      { capabilityId: READ_BALANCE.capability.id, major: 1, inputs: { memberId: MEMBER }, targetUrl: `${FAKE_ORIGIN}/` },
      { stepTimeoutMs: STEP_TIMEOUT_MS },
    );

    await expect(replayed).rejects.toThrow('ENOSPC');
    expect(evidence.results).toEqual([]);
  });
});

describe('pollUntil', () => {
  it('stops at the first probe that is done', async () => {
    const clock = createFakeClock();
    let probes = 0;

    const value = await pollUntil(clock, 1_000, 250, () => Promise.resolve({ done: ++probes === 2, value: probes }));

    expect(value).toBe(2);
    expect(clock.sleeps).toEqual([250]);
  });

  it('returns the last probe once the deadline passes, having probed at least once', async () => {
    const clock = createFakeClock(5_000);

    await expect(pollUntil(clock, 1_000, 250, () => Promise.resolve({ done: false, value: 'late' }))).resolves.toBe('late');
    expect(clock.sleeps).toEqual([]);
  });
});
