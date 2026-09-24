import type { Action } from '../../models/action';
import type { TargetSpec } from '../../models/capability';
import type { Observation } from '../../models/observation';
import type { PolicyDecision } from '../../models/policy';
import type { PerformOutcome, Resolution } from '../../models/resolution';
import type { ActionPurpose } from '../../models/run-event';
import type { SessionCookie } from '../session/port';

export type GatewayRequest = {
  readonly stepId: string;
  readonly purpose: ActionPurpose;
  readonly action: Action;
  readonly timeoutMs: number;
};

export type GatewayOutcome = PerformOutcome | { readonly status: 'denied'; readonly reason: string };

// The only way controllers reach the surface (ADR-011): every action is checked against
// the policy before the driver is called. Observing and resolving do not change the page.
export type ActionGateway = {
  // Loads url with the session cookies after checking it against the policy.
  open(url: string, session: readonly SessionCookie[]): Promise<PolicyDecision>;
  observe(): Promise<Observation>;
  resolve(target: TargetSpec): Promise<Resolution>;
  perform(request: GatewayRequest): Promise<GatewayOutcome>;
  screenshot(): Promise<Uint8Array>;
};
