import { z } from 'zod';
import { ModelStepSchema, type AgentDecision, type ModelStep } from '../models/action';

export type ModelDecisionResult =
  | { readonly ok: true; readonly decision: AgentDecision }
  | { readonly ok: false; readonly reason: string };

const MAX_REASON_LENGTH = 200;

function reject(reason: string): ModelDecisionResult {
  const line = reason.replace(/\s*\n\s*/g, '; ');
  return { ok: false, reason: line.length > MAX_REASON_LENGTH ? `${line.slice(0, MAX_REASON_LENGTH - 3)}...` : line };
}

type Field = 'target' | 'argument';

function requires(step: ModelStep, ...fields: Field[]): string[] {
  return fields.filter((field) => step[field] === null).map((field) => `${step.verb} requires ${field}`);
}

function forbids(step: ModelStep, ...fields: Field[]): string[] {
  return fields.filter((field) => step[field] !== null).map((field) => `${step.verb} does not take ${field}`);
}

// The verb rules: which of target and argument each verb takes. Returns the broken rules instead
// when the answer breaks them.
function toDecision(step: ModelStep): AgentDecision | string[] {
  const { verb, target, argument, rationale } = step;
  switch (verb) {
    case 'click':
      if (target === null || argument !== null) return [...requires(step, 'target'), ...forbids(step, 'argument')];
      return { kind: 'act', action: { kind: 'click', ref: target }, rationale };
    case 'fill':
      if (target === null || argument === null) return requires(step, 'target', 'argument');
      return { kind: 'act', action: { kind: 'fill', ref: target, value: argument }, rationale };
    case 'select':
      if (target === null || argument === null) return requires(step, 'target', 'argument');
      return { kind: 'act', action: { kind: 'select', ref: target, option: argument }, rationale };
    case 'press':
      if (target === null || argument === null) return requires(step, 'target', 'argument');
      return { kind: 'act', action: { kind: 'press', ref: target, key: argument }, rationale };
    case 'navigate':
      if (target !== null || argument === null) return [...forbids(step, 'target'), ...requires(step, 'argument')];
      return { kind: 'act', action: { kind: 'navigate', url: argument }, rationale };
    case 'read':
      if (target === null || argument === null) return requires(step, 'target', 'argument');
      return { kind: 'read', action: { kind: 'read', ref: target }, output: argument, rationale };
    case 'finish':
      if (target !== null) return forbids(step, 'target');
      return { kind: 'finish', summary: argument, rationale };
    case 'request_help':
      if (target !== null || argument === null) return [...forbids(step, 'target'), ...requires(step, 'argument')];
      return { kind: 'request_help', message: argument, rationale };
    default: {
      const unhandled: never = verb;
      return unhandled;
    }
  }
}

// Model answer text -> domain decision. Never throws; the reason is fed back to the model.
export function parseModelDecision(content: string | null, validRefs: readonly string[]): ModelDecisionResult {
  if (content === null || content.trim() === '') return reject('the answer was empty');
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return reject('the answer was not valid JSON');
  }
  const parsed = ModelStepSchema.safeParse(json);
  if (!parsed.success) return reject(z.prettifyError(parsed.error));
  const decision = toDecision(parsed.data);
  if (Array.isArray(decision)) return reject(decision.join('; '));
  const { target } = parsed.data;
  if (target !== null && !validRefs.includes(target)) return reject(`target ${target} is not on the screen`);
  return { ok: true, decision };
}
