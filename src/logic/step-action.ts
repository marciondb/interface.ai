import type { SurfaceAction } from '../models/action';
import type { StepAction } from '../models/capability';
import type { Ref } from '../models/observation';

export type TargetedStepAction = Exclude<StepAction, { readonly kind: 'navigate' }>;

// The surface action for an artifact action on its resolved target.
export function toSurfaceAction(action: TargetedStepAction, ref: Ref): SurfaceAction {
  switch (action.kind) {
    case 'click':
      return { kind: 'click', ref };
    case 'fill':
      return { kind: 'fill', ref, value: action.value };
    case 'select':
      return { kind: 'select', ref, option: action.value };
    case 'press':
      return { kind: 'press', ref, key: action.key };
    case 'read':
      return { kind: 'read', ref };
    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}

// An artifact navigate step: its path is relative to the target application.
export function navigateAction(path: string, targetUrl: string): SurfaceAction {
  return { kind: 'navigate', url: new URL(path, targetUrl).href };
}

// "click on lookup.search", or just the verb for an action without a named target.
export function describeStepAction(action: SurfaceAction, target: string | undefined): string {
  return target === undefined ? action.kind : `${action.kind} on ${target}`;
}

// The element the action is performed on; navigate has none.
export function actionRef(action: SurfaceAction): Ref | undefined {
  return action.kind === 'navigate' ? undefined : action.ref;
}

// The text the action types, chooses, presses or opens, as recorded in the evidence.
export function actionArgument(action: SurfaceAction): string | undefined {
  switch (action.kind) {
    case 'fill':
      return action.value;
    case 'select':
      return action.option;
    case 'press':
      return action.key;
    case 'navigate':
      return action.url;
    case 'click':
    case 'read':
      return undefined;
    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}
