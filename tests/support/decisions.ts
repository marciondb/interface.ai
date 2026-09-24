import type { SurfaceActionKind, SurfaceDecision } from '../../src/models/action';

// A decision acting on ref, with argument in the field its verb takes (the read output name for read).
export function surfaceDecision(verb: SurfaceActionKind, ref: string, argument = '', rationale = 'test'): SurfaceDecision {
  switch (verb) {
    case 'click':
      return { kind: 'act', action: { kind: 'click', ref }, rationale };
    case 'fill':
      return { kind: 'act', action: { kind: 'fill', ref, value: argument }, rationale };
    case 'select':
      return { kind: 'act', action: { kind: 'select', ref, option: argument }, rationale };
    case 'press':
      return { kind: 'act', action: { kind: 'press', ref, key: argument }, rationale };
    case 'navigate':
      return { kind: 'act', action: { kind: 'navigate', url: argument }, rationale };
    case 'read':
      return { kind: 'read', action: { kind: 'read', ref }, output: argument, rationale };
    default: {
      const unhandled: never = verb;
      return unhandled;
    }
  }
}
