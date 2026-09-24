import type { EvidenceRecorder } from '../diplomat/evidence/port';
import type { ActionGateway, GatewayOutcome, OpenDecision } from '../diplomat/gateway/port';
import { isSessionError, type SessionCookie, type SessionProvider } from '../diplomat/session/port';
import type { ArtifactStore } from '../diplomat/store/port';
import { DEFAULT_POLL_INTERVAL_MS, type Clock } from '../infrastructure/clock';
import { errorMessage } from '../infrastructure/errors';
import { bindInputs, validateInputs } from '../logic/capability-inputs';
import { describeCounts, evaluatePredicate, factsNeeded, type Facts, type TargetFact } from '../logic/checkpoint';
import { classify, describeClassification, isDefinitive } from '../logic/outcome-classifier';
import { describeLanding } from '../logic/policy';
import { nextMove, type Move } from '../logic/recovery';
import { sensitiveValuesOf } from '../logic/redaction';
import { actionArgument, navigateAction, toSurfaceAction } from '../logic/step-action';
import type { SurfaceAction } from '../models/action';
import type { Capability, Predicate, Step, TargetSpec } from '../models/capability';
import type { Classification, ClassificationTrigger } from '../models/classification';
import type { EscalationReason, ExecutionResult, Failure, FailureCode, Recovery } from '../models/execution-result';
import type { Observation, Ref } from '../models/observation';
import type { ReplayRequest } from '../models/replay-request';
import type { ActionPurpose } from '../models/run-event';
import type { Escalation, Verification } from './escalation';

export type ReplayDeps = {
  readonly store: ArtifactStore;
  readonly session: SessionProvider;
  readonly gateway: ActionGateway;
  readonly evidence: EvidenceRecorder;
  // Hands the live session to a human at a risky step (RFC-005).
  readonly escalation: Escalation;
  readonly clock: Clock;
};

export type ReplayOptions = {
  // Budget for each phase of a step: finding its target, its action, its checkpoint.
  readonly stepTimeoutMs: number;
  readonly pollIntervalMs?: number;
};

type Ending =
  | { readonly status: 'succeeded'; readonly outputs: Record<string, string> }
  | { readonly status: 'business_outcome'; readonly outcome: string; readonly stepId: string }
  | { readonly status: 'failed'; readonly failure: Failure }
  | {
      readonly status: 'escalated';
      readonly interventionId: string;
      readonly stepId: string;
      readonly reason: EscalationReason;
      readonly message: string;
    };

// Why an attempt at a step stopped short, already classified.
type Problem = {
  readonly kind: 'problem';
  readonly trigger: ClassificationTrigger;
  readonly classification: Classification;
  readonly expected: string;
  readonly observed: string;
  readonly observation: Observation;
};

type HardFailure = {
  readonly kind: 'failed';
  readonly code: FailureCode;
  readonly expected: string;
  readonly observed: string;
};

// A risky action automation must not perform (ADR-011).
type HumanNeeded = { readonly kind: 'requires_human'; readonly message: string };

type AttemptOutcome = { readonly kind: 'done'; readonly value?: string } | Problem | HardFailure | HumanNeeded;

type Pass = { readonly kind: 'restart' } | { readonly kind: 'end'; readonly ending: Ending };

// CapabilitySchema guarantees every target an artifact refers to is declared.
function specOf(capability: Capability, name: string): TargetSpec {
  const spec = capability.targets[name];
  if (spec === undefined) throw new Error(`the artifact declares no target ${name}`);
  return spec;
}

// Executes a capability without a model (RFC-004): every step is resolved, performed through
// the gateway and verified; anything else is classified against the artifact's declared outcomes.
export async function replay(deps: ReplayDeps, request: ReplayRequest, options: ReplayOptions): Promise<ExecutionResult> {
  const { store, session, gateway, evidence, escalation, clock } = deps;
  const { stepTimeoutMs } = options;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const startedAt = clock.now();
  const run = await evidence.startRun({ mode: 'replay', capabilityId: request.capabilityId });
  const recoveries: Recovery[] = [];
  const interventions: string[] = [];
  let capabilityRef: ExecutionResult['capability'] = { id: request.capabilityId, requestedMajor: request.major };
  let surfaceOpened = false;
  let currentStepId = 'artifact';

  async function finish(ending: Ending): Promise<ExecutionResult> {
    const base = {
      runId: run.runId,
      capability: capabilityRef,
      durationMs: clock.now() - startedAt,
      recoveries,
      interventions,
    };
    let result: ExecutionResult;
    switch (ending.status) {
      case 'succeeded':
        result = { ...base, status: 'succeeded', outputs: ending.outputs };
        break;
      case 'business_outcome':
        result = { ...base, status: 'business_outcome', outcome: ending.outcome, details: { stepId: ending.stepId } };
        break;
      case 'failed':
        result = { ...base, status: 'failed', failure: ending.failure };
        break;
      case 'escalated':
        result = { ...base, ...ending };
        break;
      default: {
        const unhandled: never = ending;
        return unhandled;
      }
    }
    const stepId = ending.status === 'succeeded' ? undefined : ending.status === 'failed' ? ending.failure.stepId : ending.stepId;
    await evidence.event(stepId === undefined ? { type: 'result', status: result.status } : { type: 'result', status: result.status, stepId });
    await evidence.finish(result);
    return result;
  }

  // Screenshot and snapshot of the failing state; the sign-in screen is never photographed (it may show credentials).
  async function captureEvidence(stepId: string, observation: Observation | undefined): Promise<string> {
    if (!surfaceOpened) return run.dir;
    let snapshot = observation;
    let screenshot: Uint8Array | undefined;
    try {
      snapshot ??= await gateway.observe();
      if (!session.isExpired(snapshot)) screenshot = await gateway.screenshot();
    } catch {
      // Best effort: the failure itself is still reported.
    }
    const paths = await evidence.capture(stepId, { screenshot, snapshot });
    return paths.screenshot ?? paths.snapshot ?? run.dir;
  }

  async function failed(
    stepId: string,
    code: FailureCode,
    expected: string,
    observed: string,
    observation?: Observation,
  ): Promise<Ending> {
    const evidencePath = await captureEvidence(stepId, observation);
    return { status: 'failed', failure: { stepId, code, expected, observed, evidence: evidencePath } };
  }

  // Stops before a risky action with the page as it is and hands the same session to a human
  // (RFC-005). undefined when the human did it and `verify` confirmed it: the run goes on.
  async function handOff(capability: Capability, stepId: string, message: string, verify: () => Promise<Verification>): Promise<Ending | undefined> {
    const outcome = await escalation.handOff({
      run,
      mode: 'replay',
      capability: `${capability.capability.id}@${capability.capability.version}`,
      stepId,
      reason: 'risky_action',
      message,
      verify,
    });
    interventions.push(outcome.interventionId);
    if (outcome.status === 'resumed') return undefined;
    return { status: 'escalated', interventionId: outcome.interventionId, stepId, reason: outcome.cause, message: `${message} (handoff ${outcome.cause})` };
  }

  // The human performed the step: its checkpoint must hold within the step timeout.
  async function verifyStep(capability: Capability, step: Step): Promise<Verification> {
    const deadline = clock.now() + stepTimeoutMs;
    for (;;) {
      let checkpoint: { holds: boolean; expected: string; observed: string };
      try {
        const facts = await gatherFacts(capability, step.id, await gateway.observe(), [step.checkpoint]);
        checkpoint = evaluatePredicate(step.checkpoint, facts);
      } catch (error) {
        checkpoint = { holds: false, expected: 'the page to be readable', observed: errorMessage(error) };
      }
      if (checkpoint.holds || clock.now() >= deadline) {
        await evidence.event({ type: 'checkpoint', stepId: step.id, ...checkpoint, performedBy: 'human' });
        return checkpoint.holds ? { held: true } : { held: false, expected: checkpoint.expected, observed: checkpoint.observed };
      }
      await clock.sleep(pollIntervalMs);
    }
  }

  async function recordRecovery(recovery: Recovery, delayMs?: number): Promise<void> {
    recoveries.push(recovery);
    await evidence.event(
      delayMs === undefined
        ? { type: 'recovery', stepId: recovery.stepId, recovery }
        : { type: 'recovery', stepId: recovery.stepId, recovery, delayMs },
    );
  }

  // `output` is the name a read captures into, recorded as its argument.
  async function perform(stepId: string, purpose: ActionPurpose, action: SurfaceAction, target?: string, output?: string): Promise<GatewayOutcome> {
    const outcome = await gateway.perform({ stepId, purpose, action, timeoutMs: stepTimeoutMs });
    const policy = { type: 'policy', stepId, purpose, verb: action.kind } as const;
    switch (outcome.status) {
      case 'denied':
        await evidence.event({ ...policy, decision: 'deny', reason: outcome.reason });
        return outcome;
      case 'landed_outside_policy':
        await evidence.event({ ...policy, decision: 'deny', reason: describeLanding(outcome) });
        return outcome;
      case 'requires_human':
        await evidence.event({ ...policy, decision: 'requires_human', reason: outcome.reason });
        return outcome;
      case 'done':
      case 'timeout':
      case 'error':
        break;
      default: {
        const unhandled: never = outcome;
        return unhandled;
      }
    }
    if (purpose === 'checkpoint') return outcome;
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
    return outcome;
  }

  async function gatherFacts(
    capability: Capability,
    stepId: string,
    observation: Observation,
    predicates: readonly Predicate[],
  ): Promise<Facts> {
    const targets: Record<string, TargetFact> = {};
    for (const { target, needsValue } of factsNeeded(predicates)) {
      const spec = specOf(capability, target);
      const resolution = await gateway.resolve(spec);
      let value: string | undefined;
      if (resolution.status === 'resolved' && needsValue) {
        const outcome = await perform(stepId, 'checkpoint', { kind: 'read', ref: resolution.ref });
        if (outcome.status === 'done') value = outcome.value;
      }
      targets[target] = { candidates: spec.candidates, counts: resolution.counts, resolved: resolution.status === 'resolved', value };
    }
    return { observation, targets };
  }

  async function classifyNow(
    capability: Capability,
    stepId: string,
    trigger: ClassificationTrigger,
    serverError: boolean,
    counts?: readonly number[],
  ): Promise<{ observation: Observation; classification: Classification }> {
    const observation = await gateway.observe();
    const facts = await gatherFacts(
      capability,
      stepId,
      observation,
      capability.outcomes.map((outcome) => outcome.when),
    );
    const classification = classify({
      trigger,
      facts,
      outcomes: capability.outcomes,
      sessionExpired: session.isExpired(observation),
      serverError,
      counts,
    });
    return { observation, classification };
  }

  // Polls until the target resolves, a definitive condition shows, or the step timeout passes.
  async function waitForTarget(
    capability: Capability,
    step: Step,
    name: string,
  ): Promise<{ kind: 'resolved'; ref: Ref } | Problem> {
    const spec = specOf(capability, name);
    const deadline = clock.now() + stepTimeoutMs;
    for (;;) {
      const resolution = await gateway.resolve(spec);
      if (resolution.status === 'resolved') {
        const { ref, candidateIndex, strategy, counts } = resolution;
        await evidence.event({ type: 'target_resolved', stepId: step.id, target: name, candidateIndex, strategy, counts });
        return { kind: 'resolved', ref };
      }
      const { observation, classification } = await classifyNow(capability, step.id, 'target_unresolved', false, resolution.counts);
      if (isDefinitive(classification) || clock.now() >= deadline) {
        await evidence.event({ type: 'target_unresolved', stepId: step.id, target: name, counts: resolution.counts });
        return {
          kind: 'problem',
          trigger: 'target_unresolved',
          classification,
          expected: `${name} matches exactly one element`,
          observed: `${name} did not resolve: ${describeCounts(spec.candidates, resolution.counts)}`,
          observation,
        };
      }
      await clock.sleep(pollIntervalMs);
    }
  }

  async function waitForCheckpoint(capability: Capability, step: Step, serverError: boolean): Promise<{ kind: 'holds' } | Problem> {
    const predicates = [step.checkpoint, ...capability.outcomes.map((outcome) => outcome.when)];
    const deadline = clock.now() + stepTimeoutMs;
    for (;;) {
      const observation = await gateway.observe();
      const facts = await gatherFacts(capability, step.id, observation, predicates);
      const checkpoint = evaluatePredicate(step.checkpoint, facts);
      if (checkpoint.holds) {
        await evidence.event({ type: 'checkpoint', stepId: step.id, ...checkpoint });
        return { kind: 'holds' };
      }
      const classification = classify({
        trigger: 'checkpoint_not_met',
        facts,
        outcomes: capability.outcomes,
        sessionExpired: session.isExpired(observation),
        serverError,
      });
      if (isDefinitive(classification) || clock.now() >= deadline) {
        await evidence.event({ type: 'checkpoint', stepId: step.id, ...checkpoint });
        return { kind: 'problem', trigger: 'checkpoint_not_met', classification, ...checkpoint, observation };
      }
      await clock.sleep(pollIntervalMs);
    }
  }

  async function attemptStep(capability: Capability, step: Step): Promise<AttemptOutcome> {
    let action: SurfaceAction;
    let name: string | undefined;
    if (step.action.kind === 'navigate') {
      action = navigateAction(step.action.path, request.targetUrl);
    } else {
      name = step.action.target;
      const found = await waitForTarget(capability, step, name);
      if (found.kind === 'problem') return found;
      action = toSurfaceAction(step.action, found.ref);
    }
    const what = name === undefined ? action.kind : `${action.kind} on ${name}`;
    // The artifact's risk holds even if policy.json changes (RFC-006): the gateway is only asked
    // whether the policy denies the step, since deny wins over handing it to a human.
    if (step.risk === 'risky') {
      const decision = await gateway.check(action);
      if (decision.decision === 'deny') {
        await evidence.event({ type: 'policy', stepId: step.id, purpose: 'step', verb: action.kind, decision: 'deny', reason: decision.reason });
        return { kind: 'failed', code: 'policy_denied', expected: `${what} allowed by policy`, observed: decision.reason };
      }
      return { kind: 'requires_human', message: `step ${step.id} is risky: ${what} needs a human` };
    }
    const outcome = await perform(step.id, 'step', action, name, step.action.kind === 'read' ? step.action.output : undefined);
    let serverError = false;
    let value: string | undefined;
    switch (outcome.status) {
      case 'denied':
        return { kind: 'failed', code: 'policy_denied', expected: `${what} allowed by policy`, observed: outcome.reason };
      case 'landed_outside_policy': {
        // The sign-in page is the one place off the allowlist a run recovers from: the session
        // provider owns it (ADR-013), so an expired session is still reauthenticated.
        const { observation, classification } = await classifyNow(capability, step.id, 'checkpoint_not_met', false);
        if (classification.kind === 'session_expired') {
          return { kind: 'problem', trigger: 'checkpoint_not_met', classification, expected: `${what} to keep the session`, observed: describeLanding(outcome), observation };
        }
        return { kind: 'failed', code: 'policy_denied', expected: `${what} to stay within the policy`, observed: describeLanding(outcome) };
      }
      case 'requires_human':
        return { kind: 'requires_human', message: `${what} needs a human: ${outcome.reason}` };
      case 'error':
        return { kind: 'failed', code: 'driver_error', expected: `${what} to complete`, observed: outcome.message };
      case 'timeout': {
        const { observation, classification } = await classifyNow(capability, step.id, 'action_timeout', false);
        return {
          kind: 'problem',
          trigger: 'action_timeout',
          classification,
          expected: `${what} to finish loading within ${String(stepTimeoutMs)} ms`,
          observed: `still loading after ${String(stepTimeoutMs)} ms`,
          observation,
        };
      }
      case 'done':
        serverError = outcome.navigations.some((navigation) => navigation.status >= 500);
        value = outcome.value;
        // Before the checkpoint, whose evidence may quote the value.
        if (step.action.kind === 'read' && value !== undefined) {
          evidence.protect(sensitiveValuesOf(capability, {}, { [step.action.output]: value }));
        }
        break;
      default: {
        const unhandled: never = outcome;
        return unhandled;
      }
    }

    const checked = await waitForCheckpoint(capability, step, serverError);
    if (checked.kind === 'problem') return checked;
    return value === undefined ? { kind: 'done' } : { kind: 'done', value };
  }

  // Clicks the declared recovery control; the step is then attempted again.
  async function applyRecovery(capability: Capability, stepId: string, move: Extract<Move, { move: 'apply_recovery' }>): Promise<Ending | undefined> {
    const name = move.recover.target;
    const spec = specOf(capability, name);
    const resolution = await gateway.resolve(spec);
    if (resolution.status === 'unresolved') {
      return failed(
        stepId,
        'recovery_exhausted',
        `${name} to dismiss ${move.outcomeId}`,
        `${name} did not resolve: ${describeCounts(spec.candidates, resolution.counts)}`,
      );
    }
    const outcome = await perform(stepId, 'recovery', toSurfaceAction(move.recover, resolution.ref), name);
    switch (outcome.status) {
      case 'denied':
        return failed(stepId, 'policy_denied', `click on ${name} allowed by policy`, outcome.reason);
      case 'landed_outside_policy':
        return failed(stepId, 'policy_denied', `click on ${name} allowed by policy`, describeLanding(outcome));
      case 'requires_human': {
        const condition = capability.outcomes.find((declared) => declared.id === move.outcomeId)?.when;
        return handOff(capability, stepId, `click on ${name} needs a human: ${outcome.reason}`, async () => {
          if (condition === undefined) return { held: true };
          const shown = evaluatePredicate(condition, await gatherFacts(capability, stepId, await gateway.observe(), [condition]));
          return shown.holds ? { held: false, expected: `${move.outcomeId} to be dismissed`, observed: shown.observed } : { held: true };
        });
      }
      case 'error':
        return failed(stepId, 'driver_error', `click on ${name} to complete`, outcome.message);
      case 'done':
      case 'timeout':
        return undefined;
      default: {
        const unhandled: never = outcome;
        return unhandled;
      }
    }
  }

  async function runSteps(capability: Capability, reauthUsed: boolean): Promise<Pass> {
    const end = (ending: Ending): Pass => ({ kind: 'end', ending });
    const outputs: Record<string, string> = {};
    for (const step of capability.steps) {
      currentStepId = step.id;
      for (let attempt = 0; ; ) {
        await evidence.event({ type: 'step_started', stepId: step.id, attempt, action: step.action.kind });
        const outcome = await attemptStep(capability, step);
        if (outcome.kind === 'done') {
          if (step.action.kind === 'read' && outcome.value !== undefined) {
            outputs[step.action.output] = outcome.value;
            await evidence.event({ type: 'output', stepId: step.id, name: step.action.output, value: outcome.value });
          }
          break;
        }
        if (outcome.kind === 'failed') return end(await failed(step.id, outcome.code, outcome.expected, outcome.observed));
        if (outcome.kind === 'requires_human') {
          const ended = await handOff(capability, step.id, outcome.message, () => verifyStep(capability, step));
          if (ended !== undefined) return end(ended);
          break;
        }

        const { trigger, classification } = outcome;
        await evidence.event({ type: 'classification', stepId: step.id, trigger, classification });
        const move = nextMove(classification, { attempt, reauthUsed });
        switch (move.move) {
          case 'return_business':
            return end({ status: 'business_outcome', outcome: move.outcomeId, stepId: step.id });
          case 'apply_recovery': {
            attempt += 1;
            await recordRecovery({ stepId: step.id, condition: 'outcome', outcomeId: move.outcomeId, response: 'declared_recovery', attempt });
            const recoveryFailed = await applyRecovery(capability, step.id, move);
            if (recoveryFailed !== undefined) return end(recoveryFailed);
            break;
          }
          case 'retry_after':
            attempt += 1;
            await recordRecovery(
              move.condition === 'timeout'
                ? { stepId: step.id, condition: 'timeout', response: 'retry', attempt }
                : { stepId: step.id, condition: 'outcome', outcomeId: move.outcomeId, response: 'retry', attempt },
              move.delayMs,
            );
            await clock.sleep(move.delayMs);
            break;
          case 'reauthenticate_and_restart':
            await recordRecovery({ stepId: step.id, condition: 'session_expired', response: 'reauthenticate', attempt: 1 });
            return { kind: 'restart' };
          case 'fail':
            return end(
              await failed(
                step.id,
                move.code,
                outcome.expected,
                `${outcome.observed} (${describeClassification(classification)})`,
                outcome.observation,
              ),
            );
          default: {
            const unhandled: never = move;
            return unhandled;
          }
        }
      }
    }
    return end({ status: 'succeeded', outputs });
  }

  // Nothing is open yet, so there is no session to hand over for requires_human.
  async function refused(decision: OpenDecision): Promise<Ending | undefined> {
    switch (decision.decision) {
      case 'allow':
        return undefined;
      case 'deny':
        return failed('preconditions', 'policy_denied', `opening ${request.targetUrl} allowed by policy`, decision.reason);
      case 'landed_outside_policy':
        return failed('preconditions', 'policy_denied', `opening ${request.targetUrl} allowed by policy`, describeLanding(decision));
      case 'requires_human':
        return failed('preconditions', 'policy_denied', `opening ${request.targetUrl} allowed for automation`, `needs a human: ${decision.reason}`);
      default: {
        const unhandled: never = decision;
        return unhandled;
      }
    }
  }

  // Checks the target, signs in (ADR-013) and loads the target through the gateway.
  async function openSurface(capability: Capability, reauthenticating: boolean): Promise<Ending | undefined> {
    currentStepId = 'preconditions';
    const notAllowed = await refused(gateway.checkOpen(request.targetUrl));
    if (notAllowed !== undefined) return notAllowed;
    let cookies: readonly SessionCookie[] = [];
    if (capability.preconditions.map((precondition) => precondition.kind).includes('authenticated_session')) {
      try {
        cookies = await session.establish(request.targetUrl);
      } catch (error) {
        if (!isSessionError(error)) throw error;
        return failed('preconditions', 'precondition_failed', 'an authenticated session', errorMessage(error));
      }
      await evidence.event({ type: 'session', event: reauthenticating ? 'reauthenticated' : 'established' });
    }
    const notOpened = await refused(await gateway.open(request.targetUrl, cookies));
    if (notOpened !== undefined) return notOpened;
    surfaceOpened = true;
    await evidence.event({ type: 'session', event: 'opened' });
    return undefined;
  }

  await evidence.event({
    type: 'run_started',
    mode: 'replay',
    capability: { id: request.capabilityId, major: request.major },
    inputNames: Object.keys(request.inputs),
    targetUrl: request.targetUrl,
  });

  const loaded = await store.loadLatest(request.capabilityId, request.major);
  if (!loaded.ok) {
    return finish(
      await failed(
        'artifact',
        'artifact_unavailable',
        `a valid ${request.capabilityId} artifact with major version ${String(request.major)}`,
        loaded.issues.join('; '),
      ),
    );
  }
  const { id, version } = loaded.capability.capability;
  capabilityRef = { id, requestedMajor: request.major, version };
  // Raw values, so they are masked even when validation rejects them.
  evidence.protect(sensitiveValuesOf(loaded.capability, request.inputs, {}));

  const validation = validateInputs(loaded.capability, request.inputs);
  if (!validation.ok) {
    const contract = `${id}@${version}`;
    return finish(
      await failed('inputs', 'invalid_input', `inputs matching the ${contract} contract`, validation.errors.map((error) => error.message).join('; ')),
    );
  }
  const capability = bindInputs(loaded.capability, validation.values);

  try {
    const notOpened = await openSurface(capability, false);
    if (notOpened !== undefined) return await finish(notOpened);
    for (let reauthUsed = false; ; reauthUsed = true) {
      const pass = await runSteps(capability, reauthUsed);
      if (pass.kind === 'end') return await finish(pass.ending);
      const notReopened = await openSurface(capability, true);
      if (notReopened !== undefined) return await finish(notReopened);
    }
  } catch (error) {
    return finish(await failed(currentStepId, 'driver_error', 'the surface to respond', errorMessage(error)));
  }
}
