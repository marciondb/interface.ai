import { evaluateLanding, evaluatePolicy, urlViolation } from '../../logic/policy';
import type { SurfaceAction } from '../../models/action';
import type { ControlOwner } from '../../models/control';
import type { Policy, PolicyDecision } from '../../models/policy';
import type { SurfaceDriver } from '../surface/port';
import { CONTROL_OWNED_BY_HUMAN, type ActionGateway, type GatewayOutcome } from './port';

export type ActionGatewayOptions = {
  readonly driver: SurfaceDriver;
  readonly policy: Policy;
  // Who holds the live session (ADR-012); automation acts only while it is 'automation'.
  readonly controlOwner: () => ControlOwner;
};

// Also installs a navigation guard on the driver, so redirects the page starts by itself
// (scripts, popups, handoffs) cannot leave the allowlist either.
export function createActionGateway({ driver, policy, controlOwner }: ActionGatewayOptions): ActionGateway {
  driver.setNavigationGuard((url) => urlViolation(url, policy) === undefined);

  function checkOpen(url: string): PolicyDecision {
    if (controlOwner() !== 'automation') return { decision: 'deny', reason: CONTROL_OWNED_BY_HUMAN };
    return evaluatePolicy({ action: { kind: 'navigate', url }, currentUrl: url }, policy);
  }

  async function check(action: SurfaceAction): Promise<PolicyDecision> {
    const element = action.kind === 'navigate' ? undefined : await driver.describe(action.ref);
    return evaluatePolicy({ action, element, currentUrl: driver.currentUrl() }, policy);
  }

  return {
    checkOpen,

    async open(url, session) {
      const decision = checkOpen(url);
      if (decision.decision !== 'allow') return decision;
      await driver.open(url, session);
      const landing = evaluateLanding({ loaded: [], frames: driver.frameUrls(), before: [] }, policy);
      return landing === undefined ? decision : { decision: 'landed_outside_policy', ...landing };
    },

    observe: () => driver.observe(),

    resolve: (target) => driver.resolve(target),

    inspect: (ref) => driver.inspect(ref),

    check,

    async perform({ action, timeoutMs }): Promise<GatewayOutcome> {
      // Reading changes nothing, so a checkpoint can still be verified while a human holds control.
      if (action.kind !== 'read' && controlOwner() !== 'automation') return { status: 'denied', reason: CONTROL_OWNED_BY_HUMAN };
      const decision = await check(action);
      switch (decision.decision) {
        case 'allow':
          break;
        case 'deny':
          return { status: 'denied', reason: decision.reason };
        case 'requires_human':
          return { status: 'requires_human', reason: decision.reason };
        default: {
          const unhandled: never = decision;
          return unhandled;
        }
      }
      if (action.kind === 'read') return driver.perform(action, { timeoutMs });
      const before = driver.frameUrls();
      const outcome = await driver.perform(action, { timeoutMs });
      const loaded = outcome.status === 'done' ? outcome.navigations.map((navigation) => navigation.url) : [];
      const landing = evaluateLanding({ loaded, frames: driver.frameUrls(), before }, policy);
      return landing === undefined ? outcome : { status: 'landed_outside_policy', ...landing };
    },

    screenshot: () => driver.screenshot(),
  };
}
