import type { EvidenceRecorder, EvidenceRun } from '../diplomat/evidence/port';
import type { ActionGateway } from '../diplomat/gateway/port';
import type { SessionProvider } from '../diplomat/session/port';
import { isSurfaceError } from '../diplomat/surface/port';
import type { ArtifactStore } from '../diplomat/store/port';
import { DEFAULT_POLL_INTERVAL_MS, type Clock } from '../infrastructure/clock';
import { bindInputs, validateInputs } from '../logic/capability-inputs';
import { describeCounts, evaluatePredicate, factsNeeded, type Facts, type PredicateResult, type TargetFact } from '../logic/checkpoint';
import { classify, describeClassification, isDefinitive } from '../logic/outcome-classifier';
import { dialogRecovery, humanCanRecover, nextMove, withDismissedDialogs, type Move, type RecoveryBudget } from '../logic/recovery';
import { sensitiveValuesOf, type SensitiveValue } from '../logic/redaction';
import { describeStepAction, navigateAction, toSurfaceAction } from '../logic/step-action';
import { afterAction, afterLanding, afterRecoveryAction, conditionDismissed, gateRiskyStep, type HumanNeeded, type StepFailure } from '../logic/step-attempt';
import type { SurfaceAction } from '../models/action';
import type { Capability, Predicate, Step, TargetSpec } from '../models/capability';
import type { Classification, ClassificationTrigger } from '../models/classification';
import type { EscalationReason, ExecutionResult, FailureCode, Recovery } from '../models/execution-result';
import type { InterventionReason, Verification } from '../models/intervention';
import type { Dialog, Observation, Ref } from '../models/observation';
import type { ReplayRequest } from '../models/replay-request';
import type { GatewayOutcome } from '../models/resolution';
import type { Escalation } from './escalation';
import { pollUntil } from './poll';
import { endRun, openSurface, photograph, recordOutcome, type ActionRecord } from './run-lifecycle';

export type ReplayDeps = {
  readonly store: ArtifactStore;
  readonly session: SessionProvider;
  readonly gateway: ActionGateway;
  readonly evidence: EvidenceRecorder;
  // Hands the live session to a human at a risky step, or at a failure a human may get past (RFC-005).
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
  | { readonly status: 'failed'; readonly failure: Extract<ExecutionResult, { status: 'failed' }>['failure'] }
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
  // The page it was classified on, for the failure evidence.
  readonly observation?: Observation;
};

type AttemptOutcome = { readonly kind: 'done'; readonly value?: string } | Problem | StepFailure | HumanNeeded;

// A step failure with the page it was seen on.
type Failure = StepFailure & { readonly observation?: Observation };

// How a pass over the steps ended: a restart after re-authenticating, or the run's ending.
type Pass = { readonly kind: 'restart' } | { readonly kind: 'end'; readonly ending: Ending };

type StepEnd = { readonly kind: 'next' } | Pass;

// How the run answers a classified problem: attempt the step again, end the pass, or fail the step.
type Response = { readonly kind: 'retry' } | Pass | Failure;

// What the result reports, whatever point the run reached.
type RunRecord = {
  readonly evidenceRun: EvidenceRun;
  readonly startedAt: number;
  capability: ExecutionResult['capability'];
  readonly recoveries: Recovery[];
  readonly interventions: string[];
};

// One run, once its artifact is loaded and its inputs are bound.
type ReplayContext = {
  readonly deps: ReplayDeps;
  readonly request: ReplayRequest;
  readonly stepTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly capability: Capability;
  readonly record: RunRecord;
  // Inputs and outputs masked in the evidence and in screenshots so far.
  readonly sensitive: SensitiveValue[];
  // Outputs read in the current pass over the steps.
  outputs: Record<string, string>;
  // The step being run, blamed for a surface failure.
  stepId: string;
  surfaceOpened: boolean;
  // A risky step is done: a restart would ask for it again.
  riskyStepDone: boolean;
  // Dialogs automation dismissed during the current step, as observations showed them.
  dialogs: Dialog[];
};

const NEXT: StepEnd = { kind: 'next' };

function end(ending: Ending): Pass {
  return { kind: 'end', ending };
}

// CapabilitySchema guarantees every target an artifact refers to is declared.
function specOf(capability: Capability, name: string): TargetSpec {
  const spec = capability.targets[name];
  if (spec === undefined) throw new Error(`the artifact declares no target ${name}`);
  return spec;
}

function maskTexts(ctx: ReplayContext): string[] {
  return ctx.sensitive.map(({ value }) => value);
}

function protect(ctx: ReplayContext, values: readonly SensitiveValue[]): void {
  ctx.deps.evidence.protect(values);
  ctx.sensitive.push(...values);
}

async function finish(evidence: EvidenceRecorder, clock: Clock, record: RunRecord, ending: Ending): Promise<ExecutionResult> {
  const base = {
    runId: record.evidenceRun.runId,
    capability: record.capability,
    durationMs: clock.now() - record.startedAt,
    recoveries: record.recoveries,
    interventions: record.interventions,
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
  return endRun(evidence, stepId === undefined ? { type: 'result', status: result.status } : { type: 'result', status: result.status, stepId }, result);
}

// failure.evidence when there is no capture to point at.
const RUN_FOLDER = '.';

// Before the surface is open there is nothing to capture: the evidence is the run folder.
function failedBeforeSurface(stepId: string, code: FailureCode, expected: string, observed: string): Ending {
  return { status: 'failed', failure: { stepId, code, expected, observed, evidence: RUN_FOLDER } };
}

// Screenshot and snapshot of the failing state; returns the most telling path.
async function captureFailure(ctx: ReplayContext, stepId: string, observation: Observation | undefined): Promise<string> {
  const { gateway, evidence } = ctx.deps;
  if (!ctx.surfaceOpened) return RUN_FOLDER;
  let snapshot = observation;
  try {
    snapshot ??= await gateway.observe();
  } catch (error) {
    // Best effort: the failure itself is still reported.
    if (!isSurfaceError(error)) throw error;
  }
  const screenshot = snapshot === undefined ? undefined : await photograph(ctx.deps, snapshot, maskTexts(ctx));
  const paths = await evidence.capture(stepId, { screenshot, snapshot });
  return paths.screenshot ?? paths.snapshot ?? RUN_FOLDER;
}

async function failed(ctx: ReplayContext, stepId: string, code: FailureCode, expected: string, observed: string, observation?: Observation): Promise<Ending> {
  const evidencePath = await captureFailure(ctx, stepId, observation);
  return { status: 'failed', failure: { stepId, code, expected, observed, evidence: evidencePath } };
}

async function recordRecovery(ctx: ReplayContext, recovery: Recovery, delayMs?: number): Promise<void> {
  ctx.record.recoveries.push(recovery);
  await ctx.deps.evidence.event(
    delayMs === undefined ? { type: 'recovery', stepId: recovery.stepId, recovery } : { type: 'recovery', stepId: recovery.stepId, recovery, delayMs },
  );
}

// Every observation of a step goes through here, so a dialog automation dismissed is noticed.
async function observe(ctx: ReplayContext): Promise<Observation> {
  const observation = await ctx.deps.gateway.observe();
  if (observation.dialog !== null) ctx.dialogs.push(observation.dialog);
  return observation;
}

async function perform(ctx: ReplayContext, record: ActionRecord): Promise<GatewayOutcome> {
  const { stepId, purpose, action } = record;
  const outcome = await ctx.deps.gateway.perform({ stepId, purpose, action, timeoutMs: ctx.stepTimeoutMs });
  await recordOutcome(ctx.deps.evidence, record, outcome);
  return outcome;
}

async function gatherFacts(ctx: ReplayContext, stepId: string, observation: Observation, predicates: readonly Predicate[]): Promise<Facts> {
  const targets: Record<string, TargetFact> = {};
  for (const { target, needsValue } of factsNeeded(predicates)) {
    const spec = specOf(ctx.capability, target);
    const resolution = await ctx.deps.gateway.resolve(spec);
    let value: string | undefined;
    if (resolution.status === 'resolved' && needsValue) {
      const outcome = await perform(ctx, { stepId, purpose: 'checkpoint', action: { kind: 'read', ref: resolution.ref } });
      if (outcome.status === 'done') value = outcome.value;
    }
    targets[target] = { candidates: spec.candidates, counts: resolution.counts, resolved: resolution.status === 'resolved', value };
  }
  return { observation, targets };
}

async function classifyNow(
  ctx: ReplayContext,
  stepId: string,
  trigger: ClassificationTrigger,
  serverError: boolean,
  counts?: readonly number[],
): Promise<{ observation: Observation; classification: Classification }> {
  const { outcomes } = ctx.capability;
  const observation = await observe(ctx);
  const facts = await gatherFacts(
    ctx,
    stepId,
    observation,
    outcomes.map((outcome) => outcome.when),
  );
  const classification = classify({ trigger, facts, outcomes, sessionExpired: ctx.deps.session.isExpired(observation), serverError, counts });
  return { observation, classification };
}

function deadline(ctx: ReplayContext): number {
  return ctx.deps.clock.now() + ctx.stepTimeoutMs;
}

// Until the target resolves, a definitive condition shows, or the step timeout passes.
async function waitForTarget(ctx: ReplayContext, step: Step, name: string): Promise<{ readonly kind: 'resolved'; readonly ref: Ref } | Problem> {
  const { gateway, evidence, clock } = ctx.deps;
  const spec = specOf(ctx.capability, name);
  const lookup = await pollUntil<{ readonly ref: Ref } | { readonly problem: Problem; readonly counts: readonly number[] }>(
    clock,
    deadline(ctx),
    ctx.pollIntervalMs,
    async () => {
      const resolution = await gateway.resolve(spec);
      if (resolution.status === 'resolved') {
        const { ref, candidateIndex, strategy, counts } = resolution;
        await evidence.event({ type: 'target_resolved', stepId: step.id, target: name, candidateIndex, strategy, counts });
        return { done: true, value: { ref } };
      }
      const { observation, classification } = await classifyNow(ctx, step.id, 'target_unresolved', false, resolution.counts);
      const problem: Problem = {
        kind: 'problem',
        trigger: 'target_unresolved',
        classification,
        expected: `${name} matches exactly one element`,
        observed: `${name} did not resolve: ${describeCounts(spec.candidates, resolution.counts)}`,
        observation,
      };
      return { done: isDefinitive(classification), value: { problem, counts: resolution.counts } };
    },
  );
  if ('ref' in lookup) return { kind: 'resolved', ref: lookup.ref };
  await evidence.event({ type: 'target_unresolved', stepId: step.id, target: name, counts: lookup.counts });
  return lookup.problem;
}

// Until the checkpoint holds, a definitive condition shows, or the step timeout passes.
async function waitForCheckpoint(ctx: ReplayContext, step: Step, serverError: boolean): Promise<{ readonly kind: 'holds' } | Problem> {
  const { outcomes } = ctx.capability;
  const predicates = [step.checkpoint, ...outcomes.map((outcome) => outcome.when)];
  const { checkpoint, problem } = await pollUntil<{ readonly checkpoint: PredicateResult; readonly problem?: Problem }>(
    ctx.deps.clock,
    deadline(ctx),
    ctx.pollIntervalMs,
    async () => {
      const observation = await observe(ctx);
      const facts = await gatherFacts(ctx, step.id, observation, predicates);
      const checkpoint = evaluatePredicate(step.checkpoint, facts);
      if (checkpoint.holds) return { done: true, value: { checkpoint } };
      const sessionExpired = ctx.deps.session.isExpired(observation);
      const classification = classify({ trigger: 'checkpoint_not_met', facts, outcomes, sessionExpired, serverError });
      const problem: Problem = { kind: 'problem', trigger: 'checkpoint_not_met', classification, ...checkpoint, observation };
      return { done: isDefinitive(classification), value: { checkpoint, problem } };
    },
  );
  await ctx.deps.evidence.event({ type: 'checkpoint', stepId: step.id, ...checkpoint });
  return problem ?? { kind: 'holds' };
}

async function readCheckpoint(ctx: ReplayContext, step: Step): Promise<PredicateResult> {
  try {
    return evaluatePredicate(step.checkpoint, await gatherFacts(ctx, step.id, await observe(ctx), [step.checkpoint]));
  } catch (error) {
    if (!isSurfaceError(error)) throw error;
    return { holds: false, expected: 'the page to be readable', observed: error.message };
  }
}

// A human did the step: its checkpoint must hold within the step timeout.
async function verifyStep(ctx: ReplayContext, step: Step, signal: AbortSignal): Promise<Verification> {
  const checkpoint = await pollUntil(
    ctx.deps.clock,
    deadline(ctx),
    ctx.pollIntervalMs,
    async () => {
      const result = await readCheckpoint(ctx, step);
      return { done: result.holds, value: result };
    },
    signal,
  );
  if (signal.aborted) return { held: false, expected: 'the operator window to stay open', observed: 'it was closed' };
  await ctx.deps.evidence.event({ type: 'checkpoint', stepId: step.id, ...checkpoint, performedBy: 'human' });
  return checkpoint.holds ? { held: true } : { held: false, expected: checkpoint.expected, observed: checkpoint.observed };
}

// A human clicked a recovery control automation may not: done once the condition no longer shows.
async function recoveryVerified(ctx: ReplayContext, stepId: string, outcomeId: string): Promise<Verification> {
  const condition = ctx.capability.outcomes.find((declared) => declared.id === outcomeId)?.when;
  if (condition === undefined) return conditionDismissed(outcomeId, undefined);
  return conditionDismissed(outcomeId, evaluatePredicate(condition, await gatherFacts(ctx, stepId, await observe(ctx), [condition])));
}

// Stops with the page as it is and hands the same session to a human (RFC-005). undefined when
// the human did it and `verify` confirmed it: the run goes on.
async function handOff(ctx: ReplayContext, stepId: string, reason: InterventionReason, message: string, verify: (signal: AbortSignal) => Promise<Verification>): Promise<Ending | undefined> {
  const { id, version } = ctx.capability.capability;
  const outcome = await ctx.deps.escalation.handOff({
    run: ctx.record.evidenceRun,
    mode: 'replay',
    capability: `${id}@${version}`,
    stepId,
    reason,
    message,
    verify,
    maskTexts: maskTexts(ctx),
  });
  ctx.record.interventions.push(outcome.interventionId);
  if (outcome.status === 'resumed') return undefined;
  return { status: 'escalated', interventionId: outcome.interventionId, stepId, reason: outcome.cause, message: `${message} (handoff ${outcome.cause})` };
}

// Finds the step's target, performs its action through the gateway and waits for its checkpoint.
async function attemptStep(ctx: ReplayContext, step: Step): Promise<AttemptOutcome> {
  let action: SurfaceAction;
  let target: string | undefined;
  if (step.action.kind === 'navigate') {
    action = navigateAction(step.action.path, ctx.request.targetUrl);
  } else {
    target = step.action.target;
    const found = await waitForTarget(ctx, step, target);
    if (found.kind === 'problem') return found;
    action = toSurfaceAction(step.action, found.ref);
  }
  const what = describeStepAction(action, target);
  if (step.risk === 'risky') {
    const decision = await ctx.deps.gateway.check(action);
    if (decision.decision === 'deny') {
      await ctx.deps.evidence.event({ type: 'policy', stepId: step.id, purpose: 'step', verb: action.kind, decision: 'deny', reason: decision.reason });
    }
    return gateRiskyStep(step.id, what, decision);
  }

  const output = step.action.kind === 'read' ? step.action.output : undefined;
  const after = afterAction(await perform(ctx, { stepId: step.id, purpose: 'step', action, target, output }), what, ctx.stepTimeoutMs);
  switch (after.kind) {
    case 'failed':
    case 'requires_human':
      return after;
    case 'landed': {
      const observation = await observe(ctx);
      const landed = afterLanding(ctx.deps.session.isExpired(observation), what, after.landing);
      if (landed.kind === 'failed') return landed;
      return { kind: 'problem', trigger: 'checkpoint_not_met', classification: { kind: 'session_expired' }, expected: landed.expected, observed: landed.observed, observation };
    }
    case 'timed_out': {
      const { observation, classification } = await classifyNow(ctx, step.id, 'action_timeout', false);
      return { kind: 'problem', trigger: 'action_timeout', classification, expected: after.expected, observed: after.observed, observation };
    }
    case 'verify':
      break;
    default: {
      const unhandled: never = after;
      return unhandled;
    }
  }
  // Before the checkpoint, whose evidence may quote the value.
  if (output !== undefined && after.value !== undefined) protect(ctx, sensitiveValuesOf(ctx.capability, {}, { [output]: after.value }));
  const checked = await waitForCheckpoint(ctx, step, after.serverError);
  if (checked.kind === 'problem') return checked;
  return after.value === undefined ? { kind: 'done' } : { kind: 'done', value: after.value };
}

// A page that does not become readable in time is a timeout like a slow action (RFC-004).
async function attemptOrTimeout(ctx: ReplayContext, step: Step): Promise<AttemptOutcome> {
  try {
    return await attemptStep(ctx, step);
  } catch (error) {
    if (!isSurfaceError(error) || error.code !== 'timeout') throw error;
    return {
      kind: 'problem',
      trigger: 'action_timeout',
      classification: { kind: 'timeout' },
      expected: `the page to be readable within ${String(ctx.stepTimeoutMs)} ms`,
      observed: error.message,
    };
  }
}

// Clicks the declared recovery control; `retry` attempts the step again.
async function applyRecovery(
  ctx: ReplayContext,
  stepId: string,
  move: Extract<Move, { move: 'apply_recovery' }>,
): Promise<{ readonly kind: 'retry' } | StepFailure | HumanNeeded> {
  const name = move.recover.target;
  const spec = specOf(ctx.capability, name);
  const resolution = await ctx.deps.gateway.resolve(spec);
  if (resolution.status === 'unresolved') {
    return {
      kind: 'failed',
      code: 'recovery_exhausted',
      expected: `${name} to dismiss ${move.outcomeId}`,
      observed: `${name} did not resolve: ${describeCounts(spec.candidates, resolution.counts)}`,
    };
  }
  return afterRecoveryAction(await perform(ctx, { stepId, purpose: 'recovery', action: toSurfaceAction(move.recover, resolution.ref), target: name }), name);
}

async function respond(ctx: ReplayContext, step: Step, problem: Problem, budget: RecoveryBudget): Promise<Response> {
  const { clock, evidence } = ctx.deps;
  const { trigger, classification } = problem;
  const stepId = step.id;
  const attempt = budget.attempt + 1;
  await evidence.event({ type: 'classification', stepId, trigger, classification });
  const move = nextMove(classification, budget);
  switch (move.move) {
    case 'return_business':
      return end({ status: 'business_outcome', outcome: move.outcomeId, stepId });
    case 'apply_recovery': {
      await recordRecovery(ctx, { stepId, condition: 'outcome', outcomeId: move.outcomeId, response: 'declared_recovery', attempt });
      const recovered = await applyRecovery(ctx, stepId, move);
      if (recovered.kind !== 'requires_human') return recovered;
      const ended = await handOff(ctx, stepId, 'risky_action', recovered.message, () => recoveryVerified(ctx, stepId, move.outcomeId));
      if (ended !== undefined) return end(ended);
      ctx.riskyStepDone = true;
      return { kind: 'retry' };
    }
    case 'retry_after':
      await recordRecovery(
        ctx,
        move.condition === 'timeout'
          ? { stepId, condition: 'timeout', response: 'retry', attempt }
          : { stepId, condition: 'outcome', outcomeId: move.outcomeId, response: 'retry', attempt },
        move.delayMs,
      );
      await clock.sleep(move.delayMs);
      return { kind: 'retry' };
    case 'reauthenticate_and_restart':
      await recordRecovery(ctx, { stepId, condition: 'session_expired', response: 'reauthenticate', attempt: 1 });
      return { kind: 'restart' };
    case 'fail': {
      const why = move.note === undefined ? describeClassification(classification) : `${describeClassification(classification)}; ${move.note}`;
      return { kind: 'failed', code: move.code, expected: problem.expected, observed: `${problem.observed} (${why})`, observation: problem.observation };
    }
    default: {
      const unhandled: never = move;
      return unhandled;
    }
  }
}

async function completeStep(ctx: ReplayContext, step: Step, value: string | undefined): Promise<void> {
  for (const dialog of ctx.dialogs) await recordRecovery(ctx, dialogRecovery(step.id, dialog));
  if (step.action.kind === 'read' && value !== undefined) {
    ctx.outputs[step.action.output] = value;
    await ctx.deps.evidence.event({ type: 'output', stepId: step.id, name: step.action.output, value });
  }
}

// Attempts the step until it is done, handed to a human, or failed. A failure a human may get
// past goes to them once, when there is an operator window; without one the run fails.
async function runStep(ctx: ReplayContext, step: Step, reauthUsed: boolean): Promise<StepEnd> {
  ctx.stepId = step.id;
  ctx.dialogs = [];
  let handedOver = false;
  for (let attempt = 0; ; attempt += 1) {
    await ctx.deps.evidence.event({ type: 'step_started', stepId: step.id, attempt, action: step.action.kind });
    const outcome = await attemptOrTimeout(ctx, step);
    if (outcome.kind === 'done') {
      await completeStep(ctx, step, outcome.value);
      return NEXT;
    }
    if (outcome.kind === 'requires_human') {
      const ended = await handOff(ctx, step.id, 'risky_action', outcome.message, (signal) => verifyStep(ctx, step, signal));
      if (ended !== undefined) return end(ended);
      ctx.riskyStepDone = true;
      return NEXT;
    }
    const next: Response = outcome.kind === 'failed' ? outcome : await respond(ctx, step, outcome, { attempt, reauthUsed, riskyStepDone: ctx.riskyStepDone });
    if (next.kind === 'retry') continue;
    if (next.kind !== 'failed') return next;

    if (!handedOver && humanCanRecover(next.code) && ctx.deps.escalation.humanSurfaceAvailable) {
      handedOver = true;
      const message = `step ${step.id} failed with ${next.code}: expected ${next.expected}; observed ${next.observed}`;
      const ended = await handOff(ctx, step.id, 'unrecoverable', message, (signal) => verifyStep(ctx, step, signal));
      if (ended !== undefined) return end(ended);
      // A read still has to capture its value from the page the human left.
      if (step.action.kind === 'read') continue;
      return NEXT;
    }
    return end(await failed(ctx, step.id, next.code, next.expected, withDismissedDialogs(next.observed, ctx.dialogs), next.observation));
  }
}

async function runSteps(ctx: ReplayContext, reauthUsed: boolean): Promise<Pass> {
  ctx.outputs = {};
  for (const step of ctx.capability.steps) {
    const ended = await runStep(ctx, step, reauthUsed);
    if (ended.kind !== 'next') return ended;
  }
  return end({ status: 'succeeded', outputs: ctx.outputs });
}

async function open(ctx: ReplayContext, reauthenticating: boolean): Promise<Ending | undefined> {
  ctx.stepId = 'preconditions';
  const signsIn = ctx.capability.preconditions.map((precondition) => precondition.kind).includes('authenticated_session');
  const refusal = await openSurface(ctx.deps, ctx.request.targetUrl, !signsIn ? 'none' : reauthenticating ? 'reauthenticate' : 'establish');
  if (refusal !== undefined) return failed(ctx, 'preconditions', refusal.code, refusal.expected, refusal.observed);
  ctx.surfaceOpened = true;
  return undefined;
}

// Only surface failures become driver_error; anything else is a bug and propagates.
async function execute(ctx: ReplayContext): Promise<Ending> {
  try {
    const notOpened = await open(ctx, false);
    if (notOpened !== undefined) return notOpened;
    for (let reauthUsed = false; ; reauthUsed = true) {
      const pass = await runSteps(ctx, reauthUsed);
      if (pass.kind === 'end') return pass.ending;
      const notReopened = await open(ctx, true);
      if (notReopened !== undefined) return notReopened;
    }
  } catch (error) {
    if (!isSurfaceError(error)) throw error;
    return failed(ctx, ctx.stepId, 'driver_error', 'the surface to respond', error.message);
  }
}

// Executes a capability without a model (RFC-004): every step is resolved, performed through
// the gateway and verified; anything else is classified against the artifact's declared outcomes.
export async function replay(deps: ReplayDeps, request: ReplayRequest, options: ReplayOptions): Promise<ExecutionResult> {
  const { store, evidence, clock } = deps;
  const startedAt = clock.now();
  const record: RunRecord = {
    evidenceRun: await evidence.startRun({ mode: 'replay', capabilityId: request.capabilityId }),
    startedAt,
    capability: { id: request.capabilityId, requestedMajor: request.major },
    recoveries: [],
    interventions: [],
  };
  await evidence.event({
    type: 'run_started',
    mode: 'replay',
    capability: { id: request.capabilityId, major: request.major },
    inputNames: Object.keys(request.inputs),
    targetUrl: request.targetUrl,
  });

  const loaded = await store.loadLatest(request.capabilityId, request.major);
  if (!loaded.ok) {
    const expected = `a valid ${request.capabilityId} artifact with major version ${String(request.major)}`;
    return finish(evidence, clock, record, failedBeforeSurface('artifact', 'artifact_unavailable', expected, loaded.issues.join('; ')));
  }
  const { id, version } = loaded.capability.capability;
  record.capability = { id, requestedMajor: request.major, version };
  // Raw values, so they are masked even when validation rejects them.
  const sensitive = sensitiveValuesOf(loaded.capability, request.inputs, {});
  evidence.protect(sensitive);

  const validation = validateInputs(loaded.capability, request.inputs);
  if (!validation.ok) {
    const expected = `inputs matching the ${id}@${version} contract`;
    return finish(evidence, clock, record, failedBeforeSurface('inputs', 'invalid_input', expected, validation.errors.map((error) => error.message).join('; ')));
  }

  const ctx: ReplayContext = {
    deps,
    request,
    stepTimeoutMs: options.stepTimeoutMs,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    capability: bindInputs(loaded.capability, validation.values),
    record,
    sensitive,
    outputs: {},
    stepId: 'preconditions',
    surfaceOpened: false,
    riskyStepDone: false,
    dialogs: [],
  };
  return finish(evidence, clock, record, await execute(ctx));
}
