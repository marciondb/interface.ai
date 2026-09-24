// Who holds the live session during a run (ADR-012, RFC-005).
export const CONTROL_STATES = ['automation', 'awaiting_human', 'human', 'verifying', 'aborted'] as const;

export const CONTROL_EVENTS = [
  'escalate',
  'operator_take',
  'operator_resume',
  'checkpoint_held',
  'checkpoint_failed',
  'operator_abort',
  'ttl_expired',
  'surface_closed',
  'no_operator_surface',
  // The handoff itself broke (e.g. its evidence could not be written): nobody may act any more.
  'handoff_failed',
] as const;

export type ControlState = (typeof CONTROL_STATES)[number];
export type ControlEvent = (typeof CONTROL_EVENTS)[number];
export type ControlOwner = 'automation' | 'human';

export type Transition = { readonly ok: true; readonly state: ControlState } | { readonly ok: false; readonly reason: string };
