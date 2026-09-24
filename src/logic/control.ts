import type { ControlEvent, ControlOwner, ControlState, Transition } from '../models/control';

const ENDINGS: readonly ControlEvent[] = ['operator_abort', 'ttl_expired', 'surface_closed'];

function next(state: ControlState, event: ControlEvent): ControlState | undefined {
  switch (state) {
    case 'automation':
      return event === 'escalate' ? 'awaiting_human' : undefined;
    case 'awaiting_human':
      if (event === 'operator_take') return 'human';
      return ENDINGS.includes(event) || event === 'no_operator_surface' ? 'aborted' : undefined;
    case 'human':
      if (event === 'operator_resume') return 'verifying';
      return ENDINGS.includes(event) ? 'aborted' : undefined;
    case 'verifying':
      if (event === 'checkpoint_held') return 'automation';
      if (event === 'checkpoint_failed') return 'human';
      // The window can go away while the checkpoint is being read.
      return event === 'surface_closed' ? 'aborted' : undefined;
    case 'aborted':
      return undefined;
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

// The control state machine of RFC-005; `aborted` is terminal.
export function transition(state: ControlState, event: ControlEvent): Transition {
  const reached = next(state, event);
  return reached === undefined ? { ok: false, reason: `${event} is not valid while ${state}` } : { ok: true, state: reached };
}

// Automation acts only while it holds control; while verifying it only observes.
export function ownerOf(state: ControlState): ControlOwner {
  switch (state) {
    case 'automation':
      return 'automation';
    case 'awaiting_human':
    case 'human':
    case 'verifying':
    case 'aborted':
      return 'human';
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}
