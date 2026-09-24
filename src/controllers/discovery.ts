import type { EscalationBroker } from '../diplomat/escalation/port';
import type { EvidenceRecorder } from '../diplomat/evidence/port';
import type { ActionGateway, GatewayOutcome } from '../diplomat/gateway/port';
import type { Reasoner, ReasonerAdapter } from '../diplomat/reasoner/port';
import type { SessionCookie, SessionProvider } from '../diplomat/session/port';
import type { ArtifactStore } from '../diplomat/store/port';
import type { Clock } from '../infrastructure/clock';
import { newId } from '../infrastructure/ids';
import { synthesizeArtifact } from '../logic/artifact-synthesis';
import { renderGoal } from '../logic/capability-request';
import { feedbackFor, missingOutputs, progressed, stopCheck, type Setback } from '../logic/discovery-rules';
import { findNode, observationRefs } from '../logic/grounding';
import { redactDeep, redactObservation, type RedactionRules, type SensitiveValue } from '../logic/redaction';
import type { AgentDecision } from '../models/action';
import type { CapabilityRequest } from '../models/capability-request';
import {
  DEFAULT_DISCOVERY_LIMITS,
  type DiscoveryEscalationReason,
  type DiscoveryFailureReason,
  type DiscoveryLimits,
  type DiscoveryResult,
  type TraceStep,
} from '../models/discovery';
import type { Observation } from '../models/observation';
import type { OutcomeCatalog } from '../models/outcome-catalog';
import type { ReasonerInfo } from '../models/run-event';

export type DiscoveryDeps = {
  readonly store: ArtifactStore;
  readonly session: SessionProvider;
  readonly gateway: ActionGateway;
  readonly reasoner: Reasoner;
  readonly evidence: EvidenceRecorder;
  readonly escalation: EscalationBroker;
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

const POLL_INTERVAL_MS = 250;

type Ending =
  | { readonly status: 'succeeded'; readonly outputs: Record<string, string> }
  | { readonly status: 'failed'; readonly reason: DiscoveryFailureReason; readonly message: string }
  | { readonly status: 'escalated'; readonly reason: DiscoveryEscalationReason; readonly stepId: string; readonly message: string };

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

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}

function failed(reason: DiscoveryFailureReason, message: string): Ending {
  return { status: 'failed', reason, message };
}

// Accomplishes the request's goal on the live surface with the model (RFC-003) and, when the
// goal holds, synthesizes and publishes the capability artifact.
export async function discover(deps: DiscoveryDeps, run: DiscoveryRun, options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { store, session, gateway, reasoner, evidence, escalation, clock } = deps;
  const { request, catalog, targetUrl } = run;
  const limits = options.limits ?? DEFAULT_DISCOVERY_LIMITS;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const rules: RedactionRules = { secrets: run.secrets, sensitive: [] };
  const info: ReasonerInfo = { adapter: reasonerKind(reasoner.adapter), model: reasoner.model };
  const capability = { id: request.capability.id, version: request.capability.version };
  const startedAt = clock.now();
  const evidenceRun = await evidence.startRun({ mode: 'discovery', capabilityId: capability.id });
  const captured: Record<string, string> = {};
  const trace: TraceStep[] = [];
  let steps = 0;
  let stalls = 0;
  let feedback: string | undefined;
  let surfaceOpened = false;

  async function finish(ending: Ending): Promise<DiscoveryResult> {
    const base = { runId: evidenceRun.runId, capability, reasoner: info, durationMs: clock.now() - startedAt, steps };
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
    await evidence.event(
      ending.status === 'succeeded' ? { type: 'result', status: ending.status } : { type: 'result', status: ending.status, reason: ending.reason },
    );
    await evidence.finish(result);
    return result;
  }

  // The sign-in screen is never photographed (it may show credentials).
  async function screenshot(stepId: string, observation: Observation): Promise<void> {
    if (!surfaceOpened || session.isExpired(observation)) return;
    try {
      await evidence.capture(stepId, { screenshot: await gateway.screenshot() });
    } catch {
      // Best effort: the run goes on without the picture.
    }
  }

  // The only observation the model, the trace and the evidence see is the redacted one.
  async function observe(): Promise<Observation> {
    return redactObservation(await gateway.observe(), rules);
  }

  async function setback(stepId: string, what: Setback): Promise<void> {
    stalls += 1;
    feedback = feedbackFor(what);
    await evidence.event({ type: 'feedback', stepId, feedback, stalls });
  }

  // undefined when an operator resumed the run.
  async function escalate(stepId: string, reason: DiscoveryEscalationReason, message: string): Promise<Ending | undefined> {
    if (surfaceOpened) await screenshot(stepId, await observe());
    await evidence.event({ type: 'escalation', stepId, interventionId: newId('int'), reason, message });
    const decision = await escalation.escalate({ runId: evidenceRun.runId, stepId, reason, message });
    if (decision === 'aborted') return { status: 'escalated', reason, stepId, message };
    stalls = 0;
    feedback = undefined;
    return undefined;
  }

  async function recordAction(stepId: string, decision: AgentDecision, target: string | undefined, outcome: GatewayOutcome): Promise<void> {
    if (outcome.status === 'denied' || outcome.status === 'requires_human') {
      const verdict = outcome.status === 'denied' ? 'deny' : 'requires_human';
      await evidence.event({ type: 'policy', stepId, purpose: 'step', verb: decision.verb, decision: verdict, reason: outcome.reason });
      return;
    }
    await evidence.event({ type: 'policy', stepId, purpose: 'step', verb: decision.verb, decision: 'allow' });
    const argument = decision.argument ?? undefined;
    await evidence.event({
      type: 'action',
      stepId,
      purpose: 'step',
      verb: decision.verb,
      ...(target === undefined ? {} : { target }),
      ...(argument === undefined ? {} : { argument }),
      outcome: outcome.status,
      ...(outcome.status === 'done' ? { navigations: outcome.navigations } : {}),
      ...(outcome.status === 'error' ? { message: outcome.message } : {}),
    });
  }

  async function publish(): Promise<Ending> {
    const synthesis = synthesizeArtifact(trace, request, catalog, {
      method: 'discovered',
      createdAt: new Date(clock.now()).toISOString(),
      runId: evidenceRun.runId,
      reasoner: info,
    });
    if (!synthesis.ok) {
      const { code, message, stepId } = synthesis.error;
      return failed('synthesis_failed', `${code}${stepId === undefined ? '' : ` at ${stepId}`}: ${message}`);
    }
    await evidence.artifact(synthesis.capability);
    const saved = await store.save(synthesis.capability);
    if (!saved.ok) return failed(saved.code === 'exists' ? 'artifact_exists' : 'artifact_invalid', saved.issues.join('; '));
    await evidence.event({ type: 'artifact', capability, steps: synthesis.capability.steps.length });
    return { status: 'succeeded', outputs: { ...captured } };
  }

  // One turn: observe, decide, ground, gate, act, check progress. undefined means keep going.
  async function turn(stepId: string): Promise<Ending | undefined> {
    const observation = await observe();
    const validRefs = observationRefs(observation);
    await evidence.event({ type: 'observation', stepId, observationId: observation.observationId, url: observation.url, elements: validRefs.length });
    await evidence.capture(stepId, { snapshot: observation });
    await screenshot(stepId, observation);
    if (validRefs.length === 0) {
      await setback(stepId, { kind: 'no_elements' });
      await clock.sleep(pollIntervalMs);
      return undefined;
    }

    const asked = clock.now();
    let decision: AgentDecision;
    try {
      decision = await reasoner.propose({
        goal: renderGoal(request, Object.keys(captured)),
        observation,
        validRefs,
        ...(feedback === undefined ? {} : { feedback }),
      });
    } catch (error) {
      if (errorName(error) !== 'ReasonerError') throw error;
      return failed('reasoner_exhausted', errorMessage(error));
    }
    const { verb, target, argument, rationale } = decision;
    await evidence.event({ type: 'decision', stepId, verb, target, argument, rationale, latencyMs: clock.now() - asked, reasoner: info });

    if (verb === 'request_help') return escalate(stepId, 'help_requested', argument ?? 'the model asked for help');
    if (verb === 'finish') {
      const missing = missingOutputs(request, captured);
      if (missing.length === 0) return publish();
      await setback(stepId, { kind: 'goal_not_met', missing });
      return undefined;
    }

    const node = target === null ? undefined : findNode(observation, target);
    if (target !== null && node === undefined) {
      await evidence.event({ type: 'grounding_rejected', stepId, target });
      await setback(stepId, { kind: 'unknown_ref', decision });
      return undefined;
    }
    const output = argument ?? '';
    if (verb === 'read' && !Object.hasOwn(request.outputs, output)) {
      await setback(stepId, { kind: 'unknown_output', decision, outputs: Object.keys(request.outputs) });
      return undefined;
    }

    // Described before acting: a click may take the element away.
    const descriptor = target === null ? undefined : redactDeep(await gateway.inspect(target), rules);
    const outcome = await gateway.perform({ stepId, purpose: 'step', action: decision, timeoutMs: options.stepTimeoutMs });
    const value = verb === 'read' && outcome.status === 'done' ? outcome.value : undefined;
    // Before the action is recorded: the element it names may show the value.
    if (value !== undefined && request.outputs[output].sensitivity !== 'none') {
      evidence.protect([{ value, sensitivity: request.outputs[output].sensitivity }]);
    }
    const described = node === undefined ? undefined : `${node.role} ${JSON.stringify(node.name === '' ? (node.label ?? '') : node.name)}`;
    await recordAction(stepId, decision, described, outcome);
    switch (outcome.status) {
      case 'denied':
        await setback(stepId, { kind: 'denied', decision, node, reason: outcome.reason });
        return undefined;
      case 'requires_human':
        return escalate(stepId, 'risky_action', `${verb} ${described ?? ''} needs a human: ${outcome.reason}`);
      case 'timeout':
        await setback(stepId, { kind: 'action_failed', decision, node, detail: 'the page did not finish loading' });
        return undefined;
      case 'error':
        await setback(stepId, { kind: 'action_failed', decision, node, detail: outcome.message });
        return undefined;
      case 'done':
        break;
      default: {
        const unhandled: never = outcome;
        return unhandled;
      }
    }

    const observationAfter = await observe();
    let capturedNewValue = false;
    if (value !== undefined) {
      capturedNewValue = captured[output] !== value;
      captured[output] = value;
      await evidence.event({ type: 'output', stepId, name: output, value });
    }
    const moved = progressed(observation, observationAfter, capturedNewValue);
    trace.push({
      stepId,
      decision,
      observation,
      ...(node === undefined || descriptor === undefined ? {} : { element: { node, descriptor } }),
      ...(value === undefined ? {} : { value }),
      observationAfter,
      progressed: moved,
    });
    await evidence.event({ type: 'progress', stepId, progressed: moved });
    if (moved) {
      stalls = 0;
      feedback = undefined;
    } else {
      await setback(stepId, { kind: 'no_progress', decision, node });
    }
    return undefined;
  }

  async function loop(): Promise<Ending> {
    let cookies: readonly SessionCookie[];
    try {
      cookies = await session.establish(targetUrl);
    } catch (error) {
      if (errorName(error) !== 'SessionError') throw error;
      return failed('precondition_failed', errorMessage(error));
    }
    await evidence.event({ type: 'session', event: 'established' });
    const opened = await gateway.open(targetUrl, cookies);
    switch (opened.decision) {
      case 'allow':
        break;
      case 'deny':
        return failed('policy_denied', `opening ${targetUrl}: ${opened.reason}`);
      case 'requires_human':
        return failed('policy_denied', `opening ${targetUrl} needs a human: ${opened.reason}`);
      default: {
        const unhandled: never = opened;
        return unhandled;
      }
    }
    surfaceOpened = true;
    await evidence.event({ type: 'session', event: 'opened' });

    for (;;) {
      const stop = stopCheck({ steps, stalls, startedAt }, limits, clock.now());
      if (stop.kind === 'fail') return failed(stop.reason, stop.message);
      if (stop.kind === 'escalate') {
        const ended = await escalate(`step-${String(steps)}`, stop.reason, stop.message);
        if (ended !== undefined) return ended;
        continue;
      }
      steps += 1;
      const ended = await turn(`step-${String(steps)}`);
      if (ended !== undefined) return ended;
    }
  }

  // Before the first event: the goal quotes the examples.
  const sensitive: SensitiveValue[] = Object.values(request.inputs).flatMap(({ example, sensitivity }) =>
    sensitivity === 'none' ? [] : [{ value: example, sensitivity }],
  );
  evidence.protect(sensitive);
  await evidence.event({
    type: 'discovery_started',
    capability,
    goal: renderGoal(request),
    inputNames: Object.keys(request.inputs),
    targetUrl,
    reasoner: info,
    limits,
  });

  // Versions are immutable (ADR-007): refuse before spending a run on an artifact that cannot be saved.
  const existing = await store.load(capability.id, capability.version);
  if (existing.ok || existing.code === 'invalid') {
    return finish(failed('artifact_exists', `${capability.id}@${capability.version} is already published; request a new version`));
  }

  try {
    return await finish(await loop());
  } catch (error) {
    return finish(failed('driver_error', errorMessage(error)));
  }
}
