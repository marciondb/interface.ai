import { z } from 'zod';
import { ActionSchema, type AgentDecision } from '../models/action';

export type ModelDecisionResult =
  | { readonly ok: true; readonly decision: AgentDecision }
  | { readonly ok: false; readonly reason: string };

const MAX_REASON_LENGTH = 200;

function reject(reason: string): ModelDecisionResult {
  const line = reason.replace(/\s*\n\s*/g, '; ');
  return { ok: false, reason: line.length > MAX_REASON_LENGTH ? `${line.slice(0, MAX_REASON_LENGTH - 3)}...` : line };
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
  const parsed = ActionSchema.safeParse(json);
  if (!parsed.success) return reject(z.prettifyError(parsed.error));
  const { target } = parsed.data;
  if (target !== null && !validRefs.includes(target)) return reject(`target ${target} is not on the screen`);
  return { ok: true, decision: parsed.data };
}
