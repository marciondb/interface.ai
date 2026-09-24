import type { Action, Verb } from './action';
import type { ElementInfo } from './resolution';

// RFC-006 allowlist. Routes match exactly; a trailing `*` makes the entry a prefix.
export type Policy = {
  readonly allowedOrigins: readonly string[];
  readonly allowedRoutes: readonly string[];
  readonly allowedActions: readonly Verb[];
};

export type PolicyRequest = {
  readonly action: Action;
  // The element action.target points at, when the action has one.
  readonly element?: ElementInfo;
  // Top-level page URL.
  readonly currentUrl: string;
};

export type PolicyDecision = { readonly decision: 'allow' } | { readonly decision: 'deny'; readonly reason: string };
