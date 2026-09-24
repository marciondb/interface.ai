import type { Outcome } from '../models/capability';
import type { Classification, ClassificationTrigger } from '../models/classification';
import { evaluatePredicate, type Facts } from './checkpoint';

export type ClassifyInput = {
  readonly trigger: ClassificationTrigger;
  readonly facts: Facts;
  readonly outcomes: readonly Outcome[];
  readonly sessionExpired: boolean;
  // A navigation of the current attempt answered with HTTP >= 500.
  readonly serverError: boolean;
  // Candidate match counts of the unresolved target (trigger target_unresolved).
  readonly counts?: readonly number[];
};

// RFC-004 order: declared business, declared recoverable, timeout, session, server, target, unknown.
export function classify(input: ClassifyInput): Classification {
  const { trigger, facts, outcomes } = input;
  for (const outcome of outcomes) {
    if (outcome.kind === 'business' && evaluatePredicate(outcome.when, facts).holds) return { kind: 'business', outcomeId: outcome.id };
  }
  for (const outcome of outcomes) {
    if (outcome.kind === 'recoverable' && evaluatePredicate(outcome.when, facts).holds) {
      return outcome.recover === undefined
        ? { kind: 'recoverable', outcomeId: outcome.id }
        : { kind: 'recoverable', outcomeId: outcome.id, recover: outcome.recover };
    }
  }
  if (trigger === 'action_timeout') return { kind: 'timeout' };
  if (input.sessionExpired) return { kind: 'session_expired' };
  if (input.serverError) return { kind: 'server_error' };
  if (trigger === 'target_unresolved') {
    return (input.counts ?? []).some((count) => count > 1) ? { kind: 'target_ambiguous' } : { kind: 'target_not_found' };
  }
  return { kind: 'unknown' };
}

// Definitive classifications end the wait for a target or checkpoint before the step timeout.
export function isDefinitive(classification: Classification): boolean {
  switch (classification.kind) {
    case 'business':
    case 'recoverable':
    case 'timeout':
    case 'session_expired':
    case 'server_error':
      return true;
    case 'target_not_found':
    case 'target_ambiguous':
    case 'unknown':
      return false;
    default: {
      const unhandled: never = classification;
      return unhandled;
    }
  }
}

export function describeClassification(classification: Classification): string {
  switch (classification.kind) {
    case 'business':
      return `business outcome ${classification.outcomeId}`;
    case 'recoverable':
      return `recoverable condition ${classification.outcomeId}`;
    case 'timeout':
      return 'the action did not finish loading in time';
    case 'session_expired':
      return 'the session expired (sign-in page shown)';
    case 'server_error':
      return 'the application answered with a server error';
    case 'target_not_found':
      return 'no candidate matched exactly one element';
    case 'target_ambiguous':
      return 'candidates matched several elements';
    case 'unknown':
      return 'no declared outcome or known condition matches the page';
    default: {
      const unhandled: never = classification;
      return unhandled;
    }
  }
}
