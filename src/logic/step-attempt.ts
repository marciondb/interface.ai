import type { FailureCode } from '../models/execution-result';
import type { Verification } from '../models/intervention';
import type { Landing, PolicyDecision } from '../models/policy';
import type { Navigation, PerformOutcome } from '../models/resolution';
import type { PredicateResult } from './checkpoint';
import { describeLanding } from './policy';

// How the action gateway answered an action (ActionGateway.perform).
export type ActionOutcome =
  | PerformOutcome
  | { readonly status: 'denied'; readonly reason: string }
  | { readonly status: 'requires_human'; readonly reason: string }
  | ({ readonly status: 'landed_outside_policy' } & Landing);

// A replay step that cannot go on; classified already, so no declared outcome applies.
export type StepFailure = { readonly kind: 'failed'; readonly code: FailureCode; readonly expected: string; readonly observed: string };

// A risky action automation must not perform (ADR-011): the step goes to a human.
export type HumanNeeded = { readonly kind: 'requires_human'; readonly message: string };

// What the replay does once the gateway answered the step's own action.
export type AfterAction =
  | StepFailure
  | HumanNeeded
  // The page ended up outside the policy: see afterLanding.
  | { readonly kind: 'landed'; readonly landing: Landing }
  | { readonly kind: 'timed_out'; readonly expected: string; readonly observed: string }
  // The action completed: its checkpoint decides.
  | { readonly kind: 'verify'; readonly value?: string; readonly serverError: boolean };

// A navigation of the attempt that the application answered with HTTP >= 500.
export function servedServerError(navigations: readonly Navigation[]): boolean {
  return navigations.some((navigation) => navigation.status >= 500);
}

// Precedence for a step the artifact marks risky: a policy deny beats handing it to a human
// (ADR-011), and the artifact's risk holds even if policy.json no longer calls it risky (RFC-006).
export function gateRiskyStep(stepId: string, what: string, decision: PolicyDecision): StepFailure | HumanNeeded {
  if (decision.decision === 'deny') return { kind: 'failed', code: 'policy_denied', expected: `${what} allowed by policy`, observed: decision.reason };
  return { kind: 'requires_human', message: `step ${stepId} is risky: ${what} needs a human` };
}

// `what` describes the action, e.g. "click on lookup.search".
export function afterAction(outcome: ActionOutcome, what: string, stepTimeoutMs: number): AfterAction {
  switch (outcome.status) {
    case 'denied':
      return { kind: 'failed', code: 'policy_denied', expected: `${what} allowed by policy`, observed: outcome.reason };
    case 'landed_outside_policy':
      return { kind: 'landed', landing: outcome };
    case 'requires_human':
      return { kind: 'requires_human', message: `${what} needs a human: ${outcome.reason}` };
    case 'error':
      return { kind: 'failed', code: 'driver_error', expected: `${what} to complete`, observed: outcome.message };
    case 'timeout':
      return {
        kind: 'timed_out',
        expected: `${what} to finish loading within ${String(stepTimeoutMs)} ms`,
        observed: `still loading after ${String(stepTimeoutMs)} ms`,
      };
    case 'done':
      return outcome.value === undefined
        ? { kind: 'verify', serverError: servedServerError(outcome.navigations) }
        : { kind: 'verify', value: outcome.value, serverError: servedServerError(outcome.navigations) };
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}

// The sign-in page is the one place off the allowlist a run recovers from: the session provider
// owns it (ADR-013), so landing there means the session expired. Anywhere else is a hard stop.
export function afterLanding(
  onSignInPage: boolean,
  what: string,
  landing: Landing,
): { readonly kind: 'session_expired'; readonly expected: string; readonly observed: string } | StepFailure {
  const observed = describeLanding(landing);
  if (onSignInPage) return { kind: 'session_expired', expected: `${what} to keep the session`, observed };
  return { kind: 'failed', code: 'policy_denied', expected: `${what} to stay within the policy`, observed };
}

// After a declared recovery control was clicked: `retry` attempts the step again.
export function afterRecoveryAction(outcome: ActionOutcome, target: string): { readonly kind: 'retry' } | StepFailure | HumanNeeded {
  const what = `click on ${target}`;
  switch (outcome.status) {
    case 'denied':
      return { kind: 'failed', code: 'policy_denied', expected: `${what} allowed by policy`, observed: outcome.reason };
    case 'landed_outside_policy':
      return { kind: 'failed', code: 'policy_denied', expected: `${what} allowed by policy`, observed: describeLanding(outcome) };
    case 'requires_human':
      return { kind: 'requires_human', message: `${what} needs a human: ${outcome.reason}` };
    case 'error':
      return { kind: 'failed', code: 'driver_error', expected: `${what} to complete`, observed: outcome.message };
    case 'done':
    case 'timeout':
      return { kind: 'retry' };
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}

// A human was asked to click a recovery control: done once the condition no longer shows.
// `shown` is the condition's detector evaluated on the page, undefined when it declares none.
export function conditionDismissed(outcomeId: string, shown: PredicateResult | undefined): Verification {
  if (shown?.holds !== true) return { held: true };
  return { held: false, expected: `${outcomeId} to be dismissed`, observed: shown.observed };
}
