import { evaluatePolicy } from '../../logic/policy';
import type { ControlOwner } from '../../models/control';
import type { Policy } from '../../models/policy';
import type { SurfaceDriver } from '../surface/port';
import type { ActionGateway } from './port';

const CONTROL_OWNED_BY_HUMAN = 'control_owned_by_human';

export type ActionGatewayOptions = {
  readonly driver: SurfaceDriver;
  readonly policy: Policy;
  // Who holds the live session (ADR-012); automation acts only while it is 'automation'.
  readonly controlOwner: () => ControlOwner;
};

export function createActionGateway({ driver, policy, controlOwner }: ActionGatewayOptions): ActionGateway {
  return {
    async open(url, session) {
      if (controlOwner() !== 'automation') return { decision: 'deny', reason: CONTROL_OWNED_BY_HUMAN };
      const decision = evaluatePolicy(
        { action: { verb: 'navigate', target: null, argument: url, rationale: 'open the target' }, currentUrl: url },
        policy,
      );
      if (decision.decision === 'allow') await driver.open(url, session);
      return decision;
    },

    observe: () => driver.observe(),

    resolve: (target) => driver.resolve(target),

    inspect: (ref) => driver.inspect(ref),

    async perform({ action, timeoutMs }) {
      // Reading changes nothing, so a checkpoint can still be verified while a human holds control.
      if (action.verb !== 'read' && controlOwner() !== 'automation') return { status: 'denied', reason: CONTROL_OWNED_BY_HUMAN };
      const element = action.target === null ? undefined : await driver.describe(action.target);
      const decision = evaluatePolicy({ action, element, currentUrl: driver.currentUrl() }, policy);
      switch (decision.decision) {
        case 'allow':
          return driver.perform(action, { timeoutMs });
        case 'deny':
          return { status: 'denied', reason: decision.reason };
        case 'requires_human':
          return { status: 'requires_human', reason: decision.reason };
        default: {
          const unhandled: never = decision;
          return unhandled;
        }
      }
    },

    screenshot: () => driver.screenshot(),
  };
}
