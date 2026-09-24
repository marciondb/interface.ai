import type { EvidenceRecorder, EvidenceRun } from '../diplomat/evidence/port';
import type { ActionGateway } from '../diplomat/gateway/port';
import { isReasonerError, type Proposal, type Reasoner, type ReasonerAdapter } from '../diplomat/reasoner/port';
import type { SessionProvider } from '../diplomat/session/port';
import { isSurfaceError } from '../diplomat/surface/port';
import type { ArtifactStore } from '../diplomat/store/port';
import { DEFAULT_POLL_INTERVAL_MS, type Clock } from '../infrastructure/clock';
import { errorMessage } from '../infrastructure/errors';
import { synthesizeArtifact } from '../logic/artifact-synthesis';
import { renderGoal } from '../logic/capability-request';
import { decisionFields, feedbackFor, missingOutputs, progressed, stopCheck, type Setback } from '../logic/discovery-rules';
import { findNode, observationRefs } from '../logic/grounding';
import { describeHumanAction, matchHumanTarget } from '../logic/human-trace';
import { describeLanding } from '../logic/policy';
import { redactDeep, redactObservation, redactText, type RedactionRules, type SensitiveValue } from '../logic/redaction';
import { actionRef } from '../logic/step-action';
import type { AgentDecision, SurfaceDecision } from '../models/action';
import type { ReasonerInfo } from '../models/capability';
import type { CapabilityRequest } from '../models/capability-request';
import {
  DEFAULT_DISCOVERY_LIMITS,
  type DiscoveryFailureReason,
  type DiscoveryLimits,
  type DiscoveryResult,
  type TraceStep,
} from '../models/discovery';
import type { ElementDescriptor } from '../models/element-descriptor';
import type { EscalationReason } from '../models/execution-result';
import type { HumanTarget, InterventionReason } from '../models/intervention';
import type { Observation, ObservationNode } from '../models/observation';
import type { OutcomeCatalog } from '../models/outcome-catalog';
import type { Escalation } from './escalation';
import { pollUntil } from './poll';
import { endRun, openSurface, photograph, recordOutcome, type OpenRefusal } from './run-lifecycle';

export type DiscoveryDeps = {
  readonly store: ArtifactStore;
  readonly session: SessionProvider;
  readonly gateway: ActionGateway;
  readonly reasoner: Reasoner;
  readonly evidence: EvidenceRecorder;
  // Hands the live session to a human when the loop cannot go on safely (RFC-005).
  readonly escalation: Escalation;
  readonly clock: Clock;
};

export type DiscoveryRun = {
  // Checked against the catalog beforehand (checkRequest).
  readonly request: CapabilityRequest;
  readonly catalog: OutcomeCatalog;
  // Entry URL of the target application.
  readonly targetUrl: string;
  // Masked in what the model and the evidence see, e.g. the target password (RFC-006).
  readonly secrets: readonly string[];
};

export type DiscoveryOptions = {
  readonly limits?: DiscoveryLimits;
  // Budget for each action and the page loads it starts.
  readonly stepTimeoutMs: number;
  readonly pollIntervalMs?: number;
};

type Ending =
  | { readonly status: 'succeeded'; readonly outputs: Record<string, string> }
  | { readonly status: 'failed'; readonly reason: DiscoveryFailureReason; readonly message: string }
  | {
      readonly status: 'escalated';
      readonly interventionId: string;
      readonly reason: EscalationReason;
      readonly stepId: string;
      readonly message: string;
    };

// One discovery run.
type DiscoveryContext = {
  readonly deps: DiscoveryDeps;
  readonly run: DiscoveryRun;
  readonly limits: DiscoveryLimits;
  readonly stepTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly evidenceRun: EvidenceRun;
  readonly info: ReasonerInfo;
  readonly capability: { readonly id: string; readonly version: string };
  readonly startedAt: number;
  // What the model, the trace and the evidence snapshots may not show: the secrets and every
  // sensitive output read so far. Inputs stay visible, since the model has to type them.
  modelRules: RedactionRules;
  // Sensitive inputs and outputs, covered in screenshots.
  readonly sensitive: SensitiveValue[];
  readonly captured: Record<string, string>;
  readonly trace: TraceStep[];
  // What humans did during handoffs, as told to the model.
  readonly byHuman: string[];
  readonly interventions: string[];
  // Model turns taken.
  steps: number;
  stalls: number;
  feedback: string | undefined;
  surfaceOpened: boolean;
};

// A surface decision the gateway completed.
type Performed = {
  readonly decision: SurfaceDecision;
  readonly observation: Observation;
  readonly node: ObservationNode | undefined;
  readonly descriptor: ElementDescriptor | undefined;
  readonly output: string | undefined;
  readonly value: string | undefined;
};

function reasonerKind(adapter: ReasonerAdapter): ReasonerInfo['adapter'] {
  switch (adapter) {
    case 'ollama':
      return 'local';
    case 'openai-compatible':
      return 'hosted';
    default: {
      const unhandled: never = adapter;
      return unhandled;
    }
  }
}

function descriptorOf(target: HumanTarget): ElementDescriptor {
  return {
    attributes: {
      ...(target.nameAttr === undefined ? {} : { name: target.nameAttr }),
      ...(target.id === undefined ? {} : { id: target.id }),
    },
  };
}

function failed(reason: DiscoveryFailureReason, message: string): Ending {
  return { status: 'failed', reason, message };
}

function openFailed(targetUrl: string, refusal: OpenRefusal): Ending {
  return failed(refusal.code, refusal.code === 'precondition_failed' ? refusal.observed : `opening ${targetUrl}: ${refusal.observed}`);
}

function goalNow(ctx: DiscoveryContext): string {
  return renderGoal(ctx.run.request, { read: Object.keys(ctx.captured), byHuman: ctx.byHuman });
}

function maskTexts(ctx: DiscoveryContext): string[] {
  return ctx.sensitive.map(({ value }) => value);
}

async function finish(ctx: DiscoveryContext, ending: Ending): Promise<DiscoveryResult> {
  const base = {
    runId: ctx.evidenceRun.runId,
    capability: ctx.capability,
    reasoner: ctx.info,
    durationMs: ctx.deps.clock.now() - ctx.startedAt,
    steps: ctx.steps,
    interventions: ctx.interventions,
  };
  let result: DiscoveryResult;
  switch (ending.status) {
    case 'succeeded':
      result = { ...base, status: 'succeeded', outputs: ending.outputs };
      break;
    case 'failed':
      result = { ...base, ...ending };
      break;
    case 'escalated':
      result = { ...base, ...ending };
      break;
    default: {
      const unhandled: never = ending;
      return unhandled;
    }
  }
  const event = ending.status === 'succeeded' ? ({ type: 'result', status: ending.status } as const) : ({ type: 'result', status: ending.status, reason: ending.reason } as const);
  return endRun(ctx.deps.evidence, event, result);
}

// The only observation the model, the trace and the evidence see is the redacted one.
async function observe(ctx: DiscoveryContext): Promise<Observation> {
  return redactObservation(await ctx.deps.gateway.observe(), ctx.modelRules);
}

// A read value of a sensitive output is masked in the evidence, in screenshots, and in every
// observation the model gets from now on.
function protectOutput(ctx: DiscoveryContext, output: string, value: string): void {
  const sensitivity = ctx.run.request.outputs[output]?.sensitivity;
  if (sensitivity === undefined || sensitivity === 'none') return;
  const sensitive: SensitiveValue = { value, sensitivity };
  ctx.deps.evidence.protect([sensitive]);
  ctx.sensitive.push(sensitive);
  ctx.modelRules = { ...ctx.modelRules, sensitive: [...ctx.modelRules.sensitive, sensitive] };
}

async function setback(ctx: DiscoveryContext, stepId: string, what: Setback): Promise<void> {
  ctx.stalls += 1;
  ctx.feedback = feedbackFor(what);
  await ctx.deps.evidence.event({ type: 'feedback', stepId, feedback: ctx.feedback, stalls: ctx.stalls });
}

// Hands the same session to a human (RFC-005). After resume, a changed page puts what they
// did in the trace as theirs; an unchanged one means they declined, told to the model (RFC-003).
// undefined when the run goes on.
async function escalate(ctx: DiscoveryContext, stepId: string, reason: InterventionReason, message: string): Promise<Ending | undefined> {
  const { escalation, clock } = ctx.deps;
  const before = await observe(ctx);
  let after: Observation | undefined;
  const outcome = await escalation.handOff({
    run: ctx.evidenceRun,
    mode: 'discovery',
    capability: `${ctx.capability.id}@${ctx.capability.version}`,
    goal: goalNow(ctx),
    stepId,
    reason,
    message,
    maskTexts: maskTexts(ctx),
    // Discovery has no step checkpoint: the fresh observation, once what the human started
    // has loaded, decides what the resume means.
    async verify(signal) {
      after = await pollUntil(
        clock,
        clock.now() + ctx.stepTimeoutMs,
        ctx.pollIntervalMs,
        async () => {
          const observation = await observe(ctx);
          return { done: progressed(before, observation, false), value: observation };
        },
        signal,
      );
      return { held: true };
    },
  });
  ctx.interventions.push(outcome.interventionId);
  if (outcome.status === 'aborted') {
    return { status: 'escalated', interventionId: outcome.interventionId, reason: outcome.cause, stepId, message: `${message} (handoff ${outcome.cause})` };
  }
  const observationAfter = after ?? (await observe(ctx));
  ctx.stalls = 0;
  ctx.feedback = undefined;
  if (!progressed(before, observationAfter, false)) {
    await setback(ctx, stepId, { kind: 'human_declined' });
    return undefined;
  }
  for (const action of outcome.actions) {
    const described = describeHumanAction(action);
    if (described !== undefined) ctx.byHuman.push(redactText(described, ctx.modelRules));
    const target = action.kind === 'click' ? redactDeep(action.target, ctx.modelRules) : undefined;
    const node = target === undefined ? undefined : matchHumanTarget(target, before);
    ctx.trace.push({
      actor: 'human',
      stepId,
      interventionId: outcome.interventionId,
      action,
      ...(target === undefined || node === undefined ? {} : { element: { node, descriptor: descriptorOf(target) } }),
      observation: before,
      observationAfter,
    });
  }
  return undefined;
}

async function publish(ctx: DiscoveryContext): Promise<Ending> {
  const { evidence, store, clock } = ctx.deps;
  const synthesis = synthesizeArtifact(ctx.trace, ctx.run.request, ctx.run.catalog, {
    method: 'discovered',
    createdAt: new Date(clock.now()).toISOString(),
    runId: ctx.evidenceRun.runId,
    reasoner: ctx.info,
  });
  if (!synthesis.ok) {
    const { code, message, stepId } = synthesis.error;
    return failed('synthesis_failed', `${code}${stepId === undefined ? '' : ` at ${stepId}`}: ${message}`);
  }
  await evidence.artifact(synthesis.capability);
  const saved = await store.save(synthesis.capability);
  if (!saved.ok) return failed(saved.code === 'exists' ? 'artifact_exists' : 'artifact_invalid', saved.issues.join('; '));
  await evidence.event({ type: 'artifact', capability: ctx.capability, steps: synthesis.capability.steps.length });
  return { status: 'succeeded', outputs: { ...ctx.captured } };
}

// Observes and records the page the model is about to decide on. The sign-in screen is never photographed.
async function observeTurn(ctx: DiscoveryContext, stepId: string): Promise<Observation> {
  const { evidence } = ctx.deps;
  const observation = await observe(ctx);
  const elements = observationRefs(observation).length;
  await evidence.event({ type: 'observation', stepId, observationId: observation.observationId, url: observation.url, elements });
  await evidence.capture(stepId, { snapshot: observation });
  const screenshot = ctx.surfaceOpened ? await photograph(ctx.deps, observation, maskTexts(ctx)) : undefined;
  if (screenshot !== undefined) await evidence.capture(stepId, { screenshot });
  return observation;
}

async function decide(ctx: DiscoveryContext, stepId: string, observation: Observation, validRefs: readonly string[]): Promise<{ decision: AgentDecision } | { ending: Ending }> {
  const { reasoner, evidence, clock } = ctx.deps;
  const asked = clock.now();
  let proposal: Proposal;
  try {
    proposal = await reasoner.propose({
      goal: goalNow(ctx),
      observation,
      validRefs,
      ...(ctx.feedback === undefined ? {} : { feedback: ctx.feedback }),
    });
  } catch (error) {
    if (!isReasonerError(error)) throw error;
    return { ending: failed('reasoner_exhausted', errorMessage(error)) };
  }
  const { decision, meta } = proposal;
  await evidence.event({
    type: 'decision',
    stepId,
    ...decisionFields(decision),
    rationale: decision.rationale,
    latencyMs: clock.now() - asked,
    reasoner: ctx.info,
    ...(meta === undefined ? {} : { providerMeta: meta }),
  });
  return { decision };
}

// After a completed action: records what was read and whether the page moved on.
async function settle(ctx: DiscoveryContext, stepId: string, performed: Performed): Promise<undefined> {
  const { decision, observation, node, descriptor, output, value } = performed;
  const observationAfter = await observe(ctx);
  let capturedNewValue = false;
  if (output !== undefined && value !== undefined) {
    capturedNewValue = ctx.captured[output] !== value;
    ctx.captured[output] = value;
    await ctx.deps.evidence.event({ type: 'output', stepId, name: output, value });
  }
  const moved = progressed(observation, observationAfter, capturedNewValue);
  ctx.trace.push({
    actor: 'agent',
    stepId,
    decision,
    observation,
    ...(node === undefined || descriptor === undefined ? {} : { element: { node, descriptor } }),
    ...(value === undefined ? {} : { value }),
    observationAfter,
    progressed: moved,
  });
  await ctx.deps.evidence.event({ type: 'progress', stepId, progressed: moved });
  if (moved) {
    ctx.stalls = 0;
    ctx.feedback = undefined;
  } else {
    await setback(ctx, stepId, { kind: 'no_progress', decision, node });
  }
  return undefined;
}

// Grounds the decision in the observation it was made on, then performs it through the gateway.
async function act(ctx: DiscoveryContext, stepId: string, observation: Observation, decision: SurfaceDecision): Promise<Ending | undefined> {
  const { gateway, evidence } = ctx.deps;
  const { action } = decision;
  const verb = action.kind;
  const ref = actionRef(action);
  const node = ref === undefined ? undefined : findNode(observation, ref);
  if (ref !== undefined && node === undefined) {
    await evidence.event({ type: 'grounding_rejected', stepId, target: ref });
    await setback(ctx, stepId, { kind: 'unknown_ref', decision });
    return undefined;
  }
  const output = decision.kind === 'read' ? decision.output : undefined;
  if (decision.kind === 'read' && !Object.hasOwn(ctx.run.request.outputs, decision.output)) {
    await setback(ctx, stepId, { kind: 'unknown_output', decision, outputs: Object.keys(ctx.run.request.outputs) });
    return undefined;
  }

  // Described before acting: a click may take the element away.
  const descriptor = ref === undefined ? undefined : redactDeep(await gateway.inspect(ref), ctx.modelRules);
  const outcome = await gateway.perform({ stepId, purpose: 'step', action, timeoutMs: ctx.stepTimeoutMs });
  const value = output !== undefined && outcome.status === 'done' ? outcome.value : undefined;
  // Before the action is recorded: the element it names may show the value.
  if (output !== undefined && value !== undefined) protectOutput(ctx, output, value);
  const described = node === undefined ? undefined : `${node.role} ${JSON.stringify(node.name === '' ? (node.label ?? '') : node.name)}`;
  await recordOutcome(evidence, { stepId, purpose: 'step', action, target: described, output }, outcome);
  switch (outcome.status) {
    case 'denied':
      await setback(ctx, stepId, { kind: 'denied', decision, node, reason: outcome.reason });
      return undefined;
    case 'landed_outside_policy':
      // The action already ran and took the page outside the policy: nothing the model sees next is safe to act on.
      return failed('policy_denied', `${verb} ${described ?? ''} ${describeLanding(outcome)}`);
    case 'requires_human':
      return escalate(ctx, stepId, 'risky_action', `${verb} ${described ?? ''} needs a human: ${outcome.reason}`);
    case 'timeout':
      await setback(ctx, stepId, { kind: 'action_failed', decision, node, detail: 'the page did not finish loading' });
      return undefined;
    case 'error':
      await setback(ctx, stepId, { kind: 'action_failed', decision, node, detail: outcome.message });
      return undefined;
    case 'done':
      return settle(ctx, stepId, { decision, observation, node, descriptor, output, value });
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}

// One turn: observe, decide, then act on the decision. undefined means keep going.
async function turn(ctx: DiscoveryContext, stepId: string): Promise<Ending | undefined> {
  const observation = await observeTurn(ctx, stepId);
  const validRefs = observationRefs(observation);
  if (validRefs.length === 0) {
    await setback(ctx, stepId, { kind: 'no_elements' });
    await ctx.deps.clock.sleep(ctx.pollIntervalMs);
    return undefined;
  }
  const asked = await decide(ctx, stepId, observation, validRefs);
  if ('ending' in asked) return asked.ending;
  const { decision } = asked;
  switch (decision.kind) {
    case 'request_help':
      return escalate(ctx, stepId, 'help_requested', decision.message);
    case 'finish': {
      const missing = missingOutputs(ctx.run.request, ctx.captured);
      if (missing.length === 0) return publish(ctx);
      await setback(ctx, stepId, { kind: 'goal_not_met', missing });
      return undefined;
    }
    case 'act':
    case 'read':
      return act(ctx, stepId, observation, decision);
    default: {
      const unhandled: never = decision;
      return unhandled;
    }
  }
}

async function explore(ctx: DiscoveryContext): Promise<Ending> {
  const refusal = await openSurface(ctx.deps, ctx.run.targetUrl, 'establish');
  if (refusal !== undefined) return openFailed(ctx.run.targetUrl, refusal);
  ctx.surfaceOpened = true;
  for (;;) {
    const stop = stopCheck({ steps: ctx.steps, stalls: ctx.stalls, startedAt: ctx.startedAt }, ctx.limits, ctx.deps.clock.now());
    if (stop.kind === 'fail') return failed(stop.reason, stop.message);
    if (stop.kind === 'escalate') {
      const ended = await escalate(ctx, `step-${String(ctx.steps)}`, stop.reason, stop.message);
      if (ended !== undefined) return ended;
      continue;
    }
    ctx.steps += 1;
    const ended = await turn(ctx, `step-${String(ctx.steps)}`);
    if (ended !== undefined) return ended;
  }
}

// Only surface failures become driver_error; anything else is a bug and propagates.
async function exploreGuarded(ctx: DiscoveryContext): Promise<Ending> {
  try {
    return await explore(ctx);
  } catch (error) {
    if (!isSurfaceError(error)) throw error;
    return failed('driver_error', error.message);
  }
}

// Accomplishes the request's goal on the live surface with the model (RFC-003) and, when the
// goal holds, synthesizes and publishes the capability artifact.
export async function discover(deps: DiscoveryDeps, run: DiscoveryRun, options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { store, reasoner, evidence, clock } = deps;
  const { request, targetUrl } = run;
  const capability = { id: request.capability.id, version: request.capability.version };
  const info: ReasonerInfo = { adapter: reasonerKind(reasoner.adapter), model: reasoner.model };
  const limits = options.limits ?? DEFAULT_DISCOVERY_LIMITS;
  const startedAt = clock.now();
  const evidenceRun = await evidence.startRun({ mode: 'discovery', capabilityId: capability.id });
  // Before the first event: the goal quotes the examples.
  const sensitive: SensitiveValue[] = Object.values(request.inputs).flatMap(({ example, sensitivity }) =>
    sensitivity === 'none' ? [] : [{ value: example, sensitivity }],
  );
  evidence.protect(sensitive);
  const ctx: DiscoveryContext = {
    deps,
    run,
    limits,
    stepTimeoutMs: options.stepTimeoutMs,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    evidenceRun,
    info,
    capability,
    startedAt,
    modelRules: { secrets: run.secrets, sensitive: [] },
    sensitive: [...sensitive],
    captured: {},
    trace: [],
    byHuman: [],
    interventions: [],
    steps: 0,
    stalls: 0,
    feedback: undefined,
    surfaceOpened: false,
  };
  await evidence.event({ type: 'discovery_started', capability, goal: renderGoal(request), inputNames: Object.keys(request.inputs), targetUrl, reasoner: info, limits });

  // Versions are immutable (ADR-007): refuse before spending a run on an artifact that cannot be saved.
  const existing = await store.load(capability.id, capability.version);
  if (existing.ok || existing.code === 'invalid') {
    return finish(ctx, failed('artifact_exists', `${capability.id}@${capability.version} is already published; request a new version`));
  }
  return finish(ctx, await exploreGuarded(ctx));
}
