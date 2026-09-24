import type { EvidenceRecorder } from '../diplomat/evidence/port';
import type { ActionGateway, OpenDecision } from '../diplomat/gateway/port';
import { isSessionError, type SessionCookie, type SessionProvider } from '../diplomat/session/port';
import { isSurfaceError } from '../diplomat/surface/port';
import { errorMessage } from '../infrastructure/errors';
import { describeLanding } from '../logic/policy';
import { actionArgument } from '../logic/step-action';
import type { SurfaceAction } from '../models/action';
import type { DiscoveryResult } from '../models/discovery';
import type { ExecutionResult } from '../models/execution-result';
import type { Observation } from '../models/observation';
import type { GatewayOutcome } from '../models/resolution';
import type { ActionPurpose, RunEvent } from '../models/run-event';

// What replay and discovery share around their own loop: opening the surface, recording what
// the gateway decided and did, photographing the page, and ending the run.
export type RunSurface = {
  readonly gateway: ActionGateway;
  readonly session: SessionProvider;
  readonly evidence: EvidenceRecorder;
};

// Why the target was not opened; `expected` and `observed` as a replay failure reports them.
export type OpenRefusal = {
  readonly code: 'policy_denied' | 'precondition_failed';
  readonly expected: string;
  readonly observed: string;
};

export type SignIn = 'establish' | 'reauthenticate' | 'none';

// Nothing is open yet, so there is no session to hand over for requires_human.
function openRefusal(targetUrl: string, decision: OpenDecision): OpenRefusal | undefined {
  const expected = `opening ${targetUrl} allowed by policy`;
  switch (decision.decision) {
    case 'allow':
      return undefined;
    case 'deny':
      return { code: 'policy_denied', expected, observed: decision.reason };
    case 'landed_outside_policy':
      return { code: 'policy_denied', expected, observed: describeLanding(decision) };
    case 'requires_human':
      return { code: 'policy_denied', expected: `opening ${targetUrl} allowed for automation`, observed: `needs a human: ${decision.reason}` };
    default: {
      const unhandled: never = decision;
      return unhandled;
    }
  }
}

// Checks the target before signing in (credentials are never sent for a URL the policy refuses),
// signs in (ADR-013) and loads the target through the gateway. undefined once it is open.
export async function openSurface({ gateway, session, evidence }: RunSurface, targetUrl: string, signIn: SignIn): Promise<OpenRefusal | undefined> {
  const notAllowed = openRefusal(targetUrl, gateway.checkOpen(targetUrl));
  if (notAllowed !== undefined) return notAllowed;
  let cookies: readonly SessionCookie[] = [];
  if (signIn !== 'none') {
    try {
      cookies = await session.establish(targetUrl);
    } catch (error) {
      if (!isSessionError(error)) throw error;
      return { code: 'precondition_failed', expected: 'an authenticated session', observed: errorMessage(error) };
    }
    await evidence.event({ type: 'session', event: signIn === 'establish' ? 'established' : 'reauthenticated' });
  }
  const notOpened = openRefusal(targetUrl, await gateway.open(targetUrl, cookies));
  if (notOpened !== undefined) return notOpened;
  await evidence.event({ type: 'session', event: 'opened' });
  return undefined;
}

// An action as the evidence names it. `output` is the name a read captures into, recorded as its argument.
export type ActionRecord = {
  readonly stepId: string;
  readonly purpose: ActionPurpose;
  readonly action: SurfaceAction;
  readonly target?: string;
  readonly output?: string;
};

// The policy decision, then what the allowed action did. A checkpoint read records only a refusal.
export async function recordOutcome(evidence: EvidenceRecorder, record: ActionRecord, outcome: GatewayOutcome): Promise<void> {
  const { stepId, purpose, action, target, output } = record;
  const policy = { type: 'policy', stepId, purpose, verb: action.kind } as const;
  switch (outcome.status) {
    case 'denied':
      await evidence.event({ ...policy, decision: 'deny', reason: outcome.reason });
      return;
    case 'landed_outside_policy':
      await evidence.event({ ...policy, decision: 'deny', reason: describeLanding(outcome) });
      return;
    case 'requires_human':
      await evidence.event({ ...policy, decision: 'requires_human', reason: outcome.reason });
      return;
    case 'done':
    case 'timeout':
    case 'error':
      break;
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }
  if (purpose === 'checkpoint') return;
  await evidence.event({ ...policy, decision: 'allow' });
  const argument = output ?? actionArgument(action);
  await evidence.event({
    type: 'action',
    stepId,
    purpose,
    verb: action.kind,
    ...(target === undefined ? {} : { target }),
    ...(argument === undefined ? {} : { argument }),
    outcome: outcome.status,
    ...(outcome.status === 'done' ? { navigations: outcome.navigations } : {}),
    ...(outcome.status === 'error' ? { message: outcome.message } : {}),
  });
}

// A PNG of the page with every element showing one of maskTexts covered
// gateway. Never the sign-in page (it may show credentials); undefined when the surface fails.
export async function photograph(
  { gateway, session }: Pick<RunSurface, 'gateway' | 'session'>,
  observation: Observation,
  maskTexts: readonly string[],
): Promise<Uint8Array | undefined> {
  if (session.isExpired(observation)) return undefined;
  try {
    return await gateway.screenshot({ maskTexts });
  } catch (error) {
    if (!isSurfaceError(error)) throw error;
    return undefined;
  }
}

// Records the result event and writes result.json; called exactly once per run.
export async function endRun<R extends ExecutionResult | DiscoveryResult>(evidence: EvidenceRecorder, event: RunEvent, result: R): Promise<R> {
  await evidence.event(event);
  await evidence.finish(result);
  return result;
}
