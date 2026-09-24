import { describe, expect, it } from 'vitest';
import { ownerOf, transition } from '../../../src/logic/control';
import { CONTROL_EVENTS, CONTROL_STATES, type ControlEvent, type ControlState } from '../../../src/models/control';

const VALID: readonly [ControlState, ControlEvent, ControlState][] = [
  ['automation', 'escalate', 'awaiting_human'],
  ['awaiting_human', 'operator_take', 'human'],
  ['awaiting_human', 'operator_abort', 'aborted'],
  ['awaiting_human', 'ttl_expired', 'aborted'],
  ['awaiting_human', 'surface_closed', 'aborted'],
  ['awaiting_human', 'no_operator_surface', 'aborted'],
  ['human', 'operator_resume', 'verifying'],
  ['human', 'operator_abort', 'aborted'],
  ['human', 'ttl_expired', 'aborted'],
  ['human', 'surface_closed', 'aborted'],
  ['verifying', 'checkpoint_held', 'automation'],
  ['verifying', 'checkpoint_failed', 'human'],
  ['verifying', 'surface_closed', 'aborted'],
];

describe('control state machine', () => {
  it.each(VALID)('%s --%s--> %s', (from, event, to) => {
    expect(transition(from, event)).toEqual({ ok: true, state: to });
  });

  it('rejects every other transition', () => {
    const valid = new Set(VALID.map(([from, event]) => `${from} ${event}`));
    for (const state of CONTROL_STATES) {
      for (const event of CONTROL_EVENTS) {
        if (valid.has(`${state} ${event}`)) continue;
        expect(transition(state, event), `${state} ${event}`).toEqual({ ok: false, reason: `${event} is not valid while ${state}` });
      }
    }
  });

  it('never lets automation resume from automation or leave aborted', () => {
    expect(transition('automation', 'operator_resume').ok).toBe(false);
    expect(CONTROL_EVENTS.map((event) => transition('aborted', event).ok)).not.toContain(true);
  });

  it('gives control to automation only in the automation state', () => {
    expect(CONTROL_STATES.map((state) => [state, ownerOf(state)])).toEqual([
      ['automation', 'automation'],
      ['awaiting_human', 'human'],
      ['human', 'human'],
      ['verifying', 'human'],
      ['aborted', 'human'],
    ]);
  });
});
