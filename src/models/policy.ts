import type { Action, Verb } from './action';
import type { ElementInfo } from './resolution';

// RFC-006 allowlist. Routes match exactly; a trailing `*` makes the entry a prefix.
export type Policy = {
  readonly allowedOrigins: readonly string[];
  readonly allowedRoutes: readonly string[];
  readonly allowedActions: readonly Verb[];
  // Actions automation must hand to a human: by destination route or by the control's accessible name.
  readonly risky: {
    readonly routes: readonly string[];
    readonly controlText: readonly string[];
  };
};

export type PolicyRequest = {
  readonly action: Action;
  // The element action.target points at, when the action has one.
  readonly element?: ElementInfo;
  // Top-level page URL.
  readonly currentUrl: string;
};

// Precedence: deny > requires_human > allow (ADR-011).
export type PolicyDecision =
  | { readonly decision: 'allow' }
  | { readonly decision: 'deny'; readonly reason: string }
  | { readonly decision: 'requires_human'; readonly reason: string };
