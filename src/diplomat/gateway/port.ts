import type { SurfaceAction } from '../../models/action';
import type { TargetSpec } from '../../models/capability';
import type { ElementDescriptor } from '../../models/element-descriptor';
import type { Observation } from '../../models/observation';
import type { Landing, PolicyDecision } from '../../models/policy';
import type { PerformOutcome, Resolution } from '../../models/resolution';
import type { ActionPurpose } from '../../models/run-event';
import type { SessionCookie } from '../session/port';
import type { ScreenshotOptions } from '../surface/port';

export type GatewayRequest = {
  readonly stepId: string;
  readonly purpose: ActionPurpose;
  readonly action: SurfaceAction;
  readonly timeoutMs: number;
};

// The denial reason while a human holds the live session (ADR-012).
export const CONTROL_OWNED_BY_HUMAN = 'control_owned_by_human';

// `denied` and `requires_human` mean the driver was not called. `denied` is outside the
// allowlist, or CONTROL_OWNED_BY_HUMAN; `requires_human` is a risky action only a human may
// perform (RFC-005). `landed_outside_policy` means the driver acted and the page ended up
// outside the policy: a hard stop.
export type GatewayOutcome =
  | PerformOutcome
  | { readonly status: 'denied'; readonly reason: string }
  | { readonly status: 'requires_human'; readonly reason: string }
  | ({ readonly status: 'landed_outside_policy' } & Landing);

// `landed_outside_policy`: the target loaded, but the page or a frame ended up outside the policy.
export type OpenDecision = PolicyDecision | ({ readonly decision: 'landed_outside_policy' } & Landing);

// The only way controllers reach the surface (ADR-011): every action is checked against
// the policy before the driver is called, and where it landed after. Observing and resolving
// do not change the page.
export type ActionGateway = {
  // What open(url) would decide, without loading anything: checked before signing in, so
  // credentials are never sent for a URL the policy refuses.
  checkOpen(url: string): PolicyDecision;
  // Loads url with the session cookies only when the policy allows it.
  open(url: string, session: readonly SessionCookie[]): Promise<OpenDecision>;
  observe(): Promise<Observation>;
  resolve(target: TargetSpec): Promise<Resolution>;
  // Describes an element of the latest observation without acting on it (discovery).
  inspect(ref: string): Promise<ElementDescriptor>;
  // The policy decision for action, without acting.
  check(action: SurfaceAction): Promise<PolicyDecision>;
  perform(request: GatewayRequest): Promise<GatewayOutcome>;
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>;
};
