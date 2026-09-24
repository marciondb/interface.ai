import type { Classification } from '../models/classification';
import type { FailureCode, Recovery } from '../models/execution-result';
import type { Dialog } from '../models/observation';

// The wait before each retry of a step: a step gets as many retries as there are waits.
const RETRY_BACKOFF_MS = [500, 1_000] as const;

export type RecoveryBudget = {
  // Retries already spent on the current step.
  readonly attempt: number;
  // Whether this run already re-authenticated.
  readonly reauthUsed: boolean;
  // Whether a risky step has completed: restarting from the first step would ask for it again.
  readonly riskyStepDone: boolean;
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
  // `note` says why a recovery that exists was not used.
  | { readonly move: 'fail'; readonly code: FailureCode; readonly note?: string };

// RFC-004 responses, with at most 2 retries per step and 1 re-authentication per run. A run never
// restarts once a risky step is done: the restart would repeat irreversible work.
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
      if (budget.reauthUsed) return { move: 'fail', code: 'session_expired' };
      if (budget.riskyStepDone) return { move: 'fail', code: 'session_expired', note: 'not restarted: a risky step is already done and a restart would repeat it' };
      return { move: 'reauthenticate_and_restart' };
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

// Failures a person at the live session may get past (requirement §3.6): the page is not what
// the artifact expects. Business outcomes, refusals, server errors and an expired session are not.
export function humanCanRecover(code: FailureCode): boolean {
  switch (code) {
    case 'target_not_found':
    case 'target_ambiguous':
    case 'checkpoint_failed':
    case 'recovery_exhausted':
      return true;
    case 'invalid_input':
    case 'artifact_unavailable':
    case 'precondition_failed':
    case 'policy_denied':
    case 'timeout':
    case 'session_expired':
    case 'server_error':
    case 'driver_error':
      return false;
    default: {
      const unhandled: never = code;
      return unhandled;
    }
  }
}

// A dialog automation dismissed during a step whose checkpoint still held.
export function dialogRecovery(stepId: string, dialog: Dialog): Recovery {
  return { stepId, condition: 'unexpected_dialog', response: 'dismissed', dialog };
}

// The failure's observed text, with every dialog automation dismissed during the step.
export function withDismissedDialogs(observed: string, dialogs: readonly Dialog[]): string {
  return [observed, ...dialogs.map((dialog) => `a ${dialog.type} dialog was dismissed: ${dialog.message}`)].join('; ');
}
