import type { EvidenceRecorder } from '../diplomat/evidence/port';
import type { ActionGateway, GatewayOutcome } from '../diplomat/gateway/port';
import type { SessionCookie, SessionProvider } from '../diplomat/session/port';
import type { ArtifactStore } from '../diplomat/store/port';
import type { Clock } from '../infrastructure/clock';
import { bindInputs, validateInputs } from '../logic/capability-inputs';
import { describeCounts, evaluateCheckpoint, factsNeeded, type Facts, type TargetFact } from '../logic/checkpoint';
import { classify, describeClassification, isDefinitive } from '../logic/outcome-classifier';
import { nextMove, type Move } from '../logic/recovery';
import { toSurfaceAction } from '../logic/step-action';
import type { Action } from '../models/action';
import { actionTarget, type Capability, type Predicate, type Step } from '../models/capability';
import type { Classification, ClassificationTrigger } from '../models/classification';
import type { ExecutionResult, Failure, FailureCode, Recovery } from '../models/execution-result';
import type { Observation, Ref } from '../models/observation';
import type { ReplayRequest } from '../models/replay-request';
import type { ActionPurpose } from '../models/run-event';

export type ReplayDeps = {
  readonly store: ArtifactStore;
  readonly session: SessionProvider;
  readonly gateway: ActionGateway;
  readonly evidence: EvidenceRecorder;
  readonly clock: Clock;
};

export type ReplayOptions = {
  // Budget for each phase of a step: finding its target, its action, its checkpoint.
  readonly stepTimeoutMs: number;
  readonly pollIntervalMs?: number;
};

const POLL_INTERVAL_MS = 250;

type Ending =
  | { readonly status: 'succeeded'; readonly outputs: Record<string, string> }
  | { readonly status: 'business_outcome'; readonly outcome: string; readonly stepId: string }
  | { readonly status: 'failed'; readonly failure: Failure };

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

type AttemptOutcome = { readonly kind: 'done'; readonly value?: string } | Problem | HardFailure;

type Pass = { readonly kind: 'restart' } | { readonly kind: 'end'; readonly ending: Ending };

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}

// Executes a capability without a model (RFC-004): every step is resolved, performed through
// the gateway and verified; anything else is classified against the artifact's declared outcomes.
export async function replay(deps: ReplayDeps, request: ReplayRequest, options: ReplayOptions): Promise<ExecutionResult> {
  const { store, session, gateway, evidence, clock } = deps;
  const { stepTimeoutMs } = options;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const startedAt = clock.now();
  const run = await evidence.startRun({ mode: 'replay', capabilityId: request.capabilityId });
  const recoveries: Recovery[] = [];
  let capabilityRef = { id: request.capabilityId, version: String(request.major) };
  let surfaceOpened = false;
  let currentStepId = 'artifact';

  async function finish(ending: Ending): Promise<ExecutionResult> {
    const base = {
      runId: run.runId,
      capability: capabilityRef,
      durationMs: clock.now() - startedAt,
      recoveries,
      interventions: [],
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
      default: {
        const unhandled: never = ending;
        return unhandled;
      }
    }
    const stepId = ending.status === 'business_outcome' ? ending.stepId : ending.status === 'failed' ? ending.failure.stepId : undefined;
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
    const paths = await evidence.failureCapture(stepId, { screenshot, snapshot });
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

  async function recordRecovery(recovery: Recovery, delayMs?: number): Promise<void> {
    recoveries.push(recovery);
    await evidence.event(
      delayMs === undefined
        ? { type: 'recovery', stepId: recovery.stepId, recovery }
        : { type: 'recovery', stepId: recovery.stepId, recovery, delayMs },
    );
  }

  async function perform(stepId: string, purpose: ActionPurpose, action: Action, target?: string): Promise<GatewayOutcome> {
    const outcome = await gateway.perform({ stepId, purpose, action, timeoutMs: stepTimeoutMs });
    if (outcome.status === 'denied' || outcome.status === 'requires_human') {
      const decision = outcome.status === 'denied' ? 'deny' : 'requires_human';
      await evidence.event({ type: 'policy', stepId, purpose, verb: action.verb, decision, reason: outcome.reason });
      return outcome;
    }
    if (purpose === 'checkpoint') return outcome;
    await evidence.event({ type: 'policy', stepId, purpose, verb: action.verb, decision: 'allow' });
    const argument = action.argument ?? undefined;
    await evidence.event({
      type: 'action',
      stepId,
      purpose,
      verb: action.verb,
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
      const spec = capability.targets[target];
      const resolution = await gateway.resolve(spec);
      let value: string | undefined;
      if (resolution.status === 'resolved' && needsValue) {
        const read: Action = { verb: 'read', target: resolution.ref, argument: target, rationale: `checkpoint ${stepId}` };
        const outcome = await perform(stepId, 'checkpoint', read);
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
    const spec = capability.targets[name];
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
      const checkpoint = evaluateCheckpoint(step.checkpoint, facts);
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
    const name = actionTarget(step.action);
    let ref: Ref | null = null;
    if (name !== undefined) {
      const found = await waitForTarget(capability, step, name);
      if (found.kind === 'problem') return found;
      ref = found.ref;
    }

    const action = toSurfaceAction(step.id, step.action, ref, request.targetUrl);
    const what = name === undefined ? action.verb : `${action.verb} on ${name}`;
    const outcome = await perform(step.id, 'step', action, name);
    let serverError = false;
    let value: string | undefined;
    switch (outcome.status) {
      case 'denied':
      case 'requires_human':
        return { kind: 'failed', code: 'policy_denied', expected: `${what} allowed by policy`, observed: outcome.reason };
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
    const spec = capability.targets[name];
    const resolution = await gateway.resolve(spec);
    if (resolution.status === 'unresolved') {
      return failed(
        stepId,
        'recovery_exhausted',
        `${name} to dismiss ${move.outcomeId}`,
        `${name} did not resolve: ${describeCounts(spec.candidates, resolution.counts)}`,
      );
    }
    const click = toSurfaceAction(stepId, move.recover, resolution.ref, request.targetUrl);
    const outcome = await perform(stepId, 'recovery', click, name);
    if (outcome.status === 'denied' || outcome.status === 'requires_human') {
      return failed(stepId, 'policy_denied', `click on ${name} allowed by policy`, outcome.reason);
    }
    if (outcome.status === 'error') return failed(stepId, 'driver_error', `click on ${name} to complete`, outcome.message);
    return undefined;
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

        const { trigger, classification } = outcome;
        await evidence.event({ type: 'classification', stepId: step.id, trigger, classification });
        const move = nextMove(classification, { attempt, reauthUsed });
        switch (move.move) {
          case 'return_business':
            return end({ status: 'business_outcome', outcome: move.outcomeId, stepId: step.id });
          case 'apply_recovery': {
            attempt += 1;
            await recordRecovery({ stepId: step.id, condition: move.outcomeId, response: 'declared_recovery', attempt });
            const recoveryFailed = await applyRecovery(capability, step.id, move);
            if (recoveryFailed !== undefined) return end(recoveryFailed);
            break;
          }
          case 'retry_after':
            attempt += 1;
            await recordRecovery({ stepId: step.id, condition: move.condition, response: 'retry', attempt }, move.delayMs);
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

  // Signs in (ADR-013) and loads the target through the gateway.
  async function openSurface(capability: Capability, reauthenticating: boolean): Promise<Ending | undefined> {
    currentStepId = 'preconditions';
    let cookies: readonly SessionCookie[] = [];
    if (capability.preconditions.map((precondition) => precondition.kind).includes('authenticated_session')) {
      try {
        cookies = await session.establish(request.targetUrl);
      } catch (error) {
        if (errorName(error) !== 'SessionError') throw error;
        return failed('preconditions', 'precondition_failed', 'an authenticated session', errorMessage(error));
      }
      await evidence.event({ type: 'session', event: reauthenticating ? 'reauthenticated' : 'established' });
    }
    const decision = await gateway.open(request.targetUrl, cookies);
    if (decision.decision !== 'allow') {
      return failed('preconditions', 'policy_denied', `opening ${request.targetUrl} allowed by policy`, decision.reason);
    }
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
  capabilityRef = { id: loaded.capability.capability.id, version: loaded.capability.capability.version };

  const validation = validateInputs(loaded.capability, request.inputs);
  if (!validation.ok) {
    const contract = `${capabilityRef.id}@${capabilityRef.version}`;
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
