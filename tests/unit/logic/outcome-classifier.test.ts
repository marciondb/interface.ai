import { describe, expect, it } from 'vitest';
import type { Facts } from '../../../src/logic/checkpoint';
import { classify, isDefinitive, type ClassifyInput } from '../../../src/logic/outcome-classifier';
import type { Outcome } from '../../../src/models/capability';
import type { Observation } from '../../../src/models/observation';

const OUTCOMES: Outcome[] = [
  { id: 'member_not_found', kind: 'business', when: { kind: 'text_visible', text: 'No records found.', frame: 'content' } },
  {
    id: 'interstitial',
    kind: 'recoverable',
    when: { kind: 'text_visible', text: 'Click Continue to proceed', frame: 'content' },
    recover: { kind: 'click', target: 'interstitial.continue' },
  },
  { id: 'banner', kind: 'recoverable', when: { kind: 'text_visible', text: 'Please wait', frame: 'content' } },
];

function page(text: string): Facts {
  const observation: Observation = {
    observationId: 1,
    url: 'http://localhost:8080/',
    frames: [
      { name: null, url: 'http://localhost:8080/' },
      { name: 'content', url: 'http://localhost:8080/member/search' },
    ],
    nodes: [{ role: 'text', name: text, frame: 'content' }],
    dialog: null,
  };
  return { observation, targets: {} };
}

function input(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    trigger: 'checkpoint_not_met',
    facts: page('Member Lookup'),
    outcomes: OUTCOMES,
    sessionExpired: false,
    serverError: false,
    ...overrides,
  };
}

describe('classify', () => {
  it('reports a declared business outcome first', () => {
    expect(classify(input({ facts: page('No records found.') }))).toEqual({ kind: 'business', outcomeId: 'member_not_found' });
  });

  it('prefers a business outcome over a server error and a timeout', () => {
    expect(classify(input({ facts: page('No records found.'), serverError: true, trigger: 'action_timeout' }))).toEqual({
      kind: 'business',
      outcomeId: 'member_not_found',
    });
  });

  it('reports a declared recoverable condition with its recovery', () => {
    expect(classify(input({ facts: page('Click Continue to proceed to your screen.'), sessionExpired: true }))).toEqual({
      kind: 'recoverable',
      outcomeId: 'interstitial',
      recover: { kind: 'click', target: 'interstitial.continue' },
    });
    expect(classify(input({ facts: page('Please wait') }))).toEqual({ kind: 'recoverable', outcomeId: 'banner' });
  });

  it('reports a timeout only when the action timed out', () => {
    expect(classify(input({ trigger: 'action_timeout', sessionExpired: true }))).toEqual({ kind: 'timeout' });
    expect(classify(input({ trigger: 'checkpoint_not_met' }))).toEqual({ kind: 'unknown' });
  });

  it('reports an expired session before a server error', () => {
    expect(classify(input({ sessionExpired: true, serverError: true }))).toEqual({ kind: 'session_expired' });
  });

  it('reports a server error', () => {
    expect(classify(input({ serverError: true, trigger: 'target_unresolved', counts: [0] }))).toEqual({ kind: 'server_error' });
  });

  it('tells a missing target from an ambiguous one', () => {
    expect(classify(input({ trigger: 'target_unresolved', counts: [0, 0] }))).toEqual({ kind: 'target_not_found' });
    expect(classify(input({ trigger: 'target_unresolved', counts: [0, 3] }))).toEqual({ kind: 'target_ambiguous' });
  });

  it('falls back to unknown', () => {
    expect(classify(input())).toEqual({ kind: 'unknown' });
  });
});

describe('isDefinitive', () => {
  it('keeps waiting only while the target or checkpoint may still appear', () => {
    expect(isDefinitive({ kind: 'business', outcomeId: 'x' })).toBe(true);
    expect(isDefinitive({ kind: 'session_expired' })).toBe(true);
    expect(isDefinitive({ kind: 'target_not_found' })).toBe(false);
    expect(isDefinitive({ kind: 'unknown' })).toBe(false);
  });
});
