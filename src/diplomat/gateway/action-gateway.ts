import { evaluatePolicy } from '../../logic/policy';
import type { Policy } from '../../models/policy';
import type { SurfaceDriver } from '../surface/port';
import type { ActionGateway } from './port';

export type ActionGatewayOptions = {
  readonly driver: SurfaceDriver;
  readonly policy: Policy;
};

export function createActionGateway({ driver, policy }: ActionGatewayOptions): ActionGateway {
  return {
    async open(url, session) {
      const decision = evaluatePolicy(
        { action: { verb: 'navigate', target: null, argument: url, rationale: 'open the target' }, currentUrl: url },
        policy,
      );
      if (decision.decision === 'allow') await driver.open(url, session);
      return decision;
    },

    observe: () => driver.observe(),

    resolve: (target) => driver.resolve(target),

    async perform({ action, timeoutMs }) {
      const element = action.target === null ? undefined : await driver.describe(action.target);
      const decision = evaluatePolicy({ action, element, currentUrl: driver.currentUrl() }, policy);
      if (decision.decision === 'deny') return { status: 'denied', reason: decision.reason };
      return driver.perform(action, { timeoutMs });
    },

    screenshot: () => driver.screenshot(),
  };
}
