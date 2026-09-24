import type { SurfaceAction, SurfaceActionKind } from './action';
import type { ElementInfo } from './resolution';

// RFC-006 allowlist. Routes match exactly; a trailing `/*` matches the route and everything under it.
export type Policy = {
  readonly allowedOrigins: readonly string[];
  readonly allowedRoutes: readonly string[];
  readonly allowedActions: readonly SurfaceActionKind[];
  // Actions automation must hand to a human: by destination route or by the control's accessible name.
  readonly risky: {
    readonly routes: readonly string[];
    readonly controlText: readonly string[];
  };
};

export type PolicyRequest = {
  readonly action: SurfaceAction;
  // The element action.ref points at, when the action has one.
  readonly element?: ElementInfo;
  // Top-level page URL.
  readonly currentUrl: string;
};

// Precedence: deny > requires_human > allow (ADR-011).
export type PolicyDecision =
  | { readonly decision: 'allow' }
  | { readonly decision: 'deny'; readonly reason: string }
  | { readonly decision: 'requires_human'; readonly reason: string };

// Where an action took the page when that is outside the policy; the driver has already acted,
// so it is a hard stop rather than feedback (ADR-011).
export type Landing = {
  readonly reason: 'landed_outside_allowlist' | 'landed_on_risky_route';
  readonly landedAt: string;
};
