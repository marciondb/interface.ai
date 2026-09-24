import type { Classification } from '../models/classification';
import type { FailureCode } from '../models/execution-result';

// The wait before each retry of a step: a step gets as many retries as there are waits.
const RETRY_BACKOFF_MS = [500, 1_000] as const;

export type RecoveryBudget = {
  // Retries already spent on the current step.
  readonly attempt: number;
  // Whether this run already re-authenticated.
  readonly reauthUsed: boolean;
};

export type Move =
  | { readonly move: 'return_business'; readonly outcomeId: string }
  | {
      readonly move: 'apply_recovery';
      readonly outcomeId: string;
      readonly recover: NonNullable<Extract<Classification, { kind: 'recoverable' }>['recover']>;
    }
  | ({ readonly move: 'retry_after'; readonly delayMs: number } & ({ readonly condition: 'timeout' } | { readonly condition: 'outcome'; readonly outcomeId: string }))
  | { readonly move: 'reauthenticate_and_restart' }
  | { readonly move: 'fail'; readonly code: FailureCode };

// RFC-004 responses, with at most 2 retries per step and 1 re-authentication per run.
export function nextMove(classification: Classification, budget: RecoveryBudget): Move {
  // undefined once the step's retries are spent.
  const delayMs: number | undefined = RETRY_BACKOFF_MS[budget.attempt];
  switch (classification.kind) {
    case 'business':
      return { move: 'return_business', outcomeId: classification.outcomeId };
    case 'recoverable':
      if (delayMs === undefined) return { move: 'fail', code: 'recovery_exhausted' };
      return classification.recover === undefined
        ? { move: 'retry_after', delayMs, condition: 'outcome', outcomeId: classification.outcomeId }
        : { move: 'apply_recovery', outcomeId: classification.outcomeId, recover: classification.recover };
    case 'timeout':
      if (delayMs === undefined) return { move: 'fail', code: 'timeout' };
      return { move: 'retry_after', delayMs, condition: 'timeout' };
    case 'session_expired':
      return budget.reauthUsed ? { move: 'fail', code: 'session_expired' } : { move: 'reauthenticate_and_restart' };
    case 'server_error':
      return { move: 'fail', code: 'server_error' };
    case 'target_not_found':
      return { move: 'fail', code: 'target_not_found' };
    case 'target_ambiguous':
      return { move: 'fail', code: 'target_ambiguous' };
    case 'unknown':
      return { move: 'fail', code: 'checkpoint_failed' };
    default: {
      const unhandled: never = classification;
      return unhandled;
    }
  }
}
