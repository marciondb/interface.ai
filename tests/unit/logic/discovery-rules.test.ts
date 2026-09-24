import { describe, expect, it } from 'vitest';
import { feedbackFor, fingerprint, missingOutputs, progressed, stopCheck } from '../../../src/logic/discovery-rules';
import type { AgentDecision } from '../../../src/models/action';
import type { CapabilityRequest } from '../../../src/models/capability-request';
import { DEFAULT_DISCOVERY_LIMITS } from '../../../src/models/discovery';
import type { Observation } from '../../../src/models/observation';
import { loginObservation } from '../../support/observations';

const CLICK: AgentDecision = { verb: 'click', target: 'e5', argument: null, rationale: 'sign on' };

function withRefsRenumbered(observation: Observation): Observation {
  return {
    ...observation,
    observationId: observation.observationId + 1,
    nodes: observation.nodes.map((node, index) => (node.ref === undefined ? node : { ...node, ref: `e${String(index + 10)}` })),
  };
}

describe('fingerprint and progressed', () => {
  it('ignores refs and observation ids, so a re-observed page counts as unchanged', () => {
    const before = loginObservation();
    const after = withRefsRenumbered(before);

    expect(fingerprint(after)).toBe(fingerprint(before));
    expect(progressed(before, after, false)).toBe(false);
  });

  it('counts a changed value, or a newly captured read, as progress', () => {
    const before = loginObservation();
    const typed = { ...before, nodes: before.nodes.map((node) => (node.ref === 'e2' ? { ...node, value: 'operator' } : node)) };

    expect(progressed(before, typed, false)).toBe(true);
    expect(progressed(before, before, true)).toBe(true);
  });
});

describe('missingOutputs', () => {
  it('lists declared outputs not captured yet', () => {
    const request = { outputs: { balance: {}, status: {} } } as unknown as CapabilityRequest;

    expect(missingOutputs(request, { balance: '1.00' })).toEqual(['status']);
    expect(missingOutputs(request, { balance: '1.00', status: 'Active' })).toEqual([]);
  });
});

describe('feedbackFor', () => {
  const node = loginObservation().nodes[5];

  it('names the element by what it shows, not by its ref', () => {
    expect(feedbackFor({ kind: 'no_progress', decision: CLICK, node })).toBe('your previous click on button "Sign On" changed nothing');
    expect(feedbackFor({ kind: 'denied', decision: CLICK, node, reason: 'route /x is not allowed' })).toBe(
      'your previous click on button "Sign On" was denied: route /x is not allowed',
    );
  });

  it('explains rejected refs, unknown outputs and an unmet goal', () => {
    expect(feedbackFor({ kind: 'unknown_ref', decision: { ...CLICK, target: 'e99' } })).toBe('e99 is not on the current screen');
    expect(feedbackFor({ kind: 'unknown_output', decision: { verb: 'read', target: 'e1', argument: 'total', rationale: 'r' }, outputs: ['balance'] })).toBe(
      '"total" is not an output of the goal; read into one of: balance',
    );
    expect(feedbackFor({ kind: 'goal_not_met', missing: ['balance'] })).toBe('the goal is not complete: not read yet: balance');
  });

  it('tells the model a human declined when they handed the screen back unchanged', () => {
    expect(feedbackFor({ kind: 'human_declined' })).toMatch(/^a human took over and handed the screen back unchanged/);
  });
});

describe('stopCheck', () => {
  const limits = DEFAULT_DISCOVERY_LIMITS;

  it('continues within the budgets', () => {
    expect(stopCheck({ steps: 5, stalls: 2, startedAt: 0 }, limits, 1_000)).toEqual({ kind: 'continue' });
  });

  it('escalates after three stalls in a row', () => {
    expect(stopCheck({ steps: 5, stalls: 3, startedAt: 0 }, limits, 1_000)).toMatchObject({ kind: 'escalate', reason: 'stalled' });
  });

  it('fails on the step budget and on the wall-clock timeout', () => {
    expect(stopCheck({ steps: 25, stalls: 0, startedAt: 0 }, limits, 1_000)).toMatchObject({ kind: 'fail', reason: 'step_budget' });
    expect(stopCheck({ steps: 1, stalls: 0, startedAt: 0 }, limits, 600_000)).toMatchObject({ kind: 'fail', reason: 'timeout' });
  });
});
