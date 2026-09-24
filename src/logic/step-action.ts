import type { Action } from '../models/action';
import type { StepAction } from '../models/capability';
import type { Ref } from '../models/observation';

// The surface action for an artifact action; ref is the resolved target, null for navigate.
export function toSurfaceAction(stepId: string, action: StepAction, ref: Ref | null, targetUrl: string): Action {
  const rationale = `replay ${stepId}`;
  switch (action.kind) {
    case 'click':
      return { verb: 'click', target: ref, argument: null, rationale };
    case 'fill':
    case 'select':
      return { verb: action.kind, target: ref, argument: action.value, rationale };
    case 'press':
      return { verb: 'press', target: ref, argument: action.key, rationale };
    case 'navigate':
      return { verb: 'navigate', target: null, argument: new URL(action.path, targetUrl).href, rationale };
    case 'read':
      return { verb: 'read', target: ref, argument: action.output, rationale };
    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}
