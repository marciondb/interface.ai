import type { Action } from '../../models/action';
import type { TargetSpec } from '../../models/capability';
import type { ElementDescriptor } from '../../models/element-descriptor';
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

// `denied` and `requires_human` mean the driver was not called. `denied` is outside the
// allowlist, or reason 'control_owned_by_human' while a human holds the live session (ADR-012);
// `requires_human` is a risky action only a human may perform (RFC-005).
export type GatewayOutcome =
  | PerformOutcome
  | { readonly status: 'denied'; readonly reason: string }
  | { readonly status: 'requires_human'; readonly reason: string };

// The only way controllers reach the surface (ADR-011): every action is checked against
// the policy before the driver is called. Observing and resolving do not change the page.
export type ActionGateway = {
  // Loads url with the session cookies only when the policy allows it.
  open(url: string, session: readonly SessionCookie[]): Promise<PolicyDecision>;
  observe(): Promise<Observation>;
  resolve(target: TargetSpec): Promise<Resolution>;
  // Describes an element of the latest observation without acting on it (discovery).
  inspect(ref: string): Promise<ElementDescriptor>;
  perform(request: GatewayRequest): Promise<GatewayOutcome>;
  screenshot(): Promise<Uint8Array>;
};
