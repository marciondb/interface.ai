import type { AgentDecision } from '../models/action';
import type { CapabilityRequest } from '../models/capability-request';
import type { DiscoveryLimits } from '../models/discovery';
import type { Observation, ObservationNode } from '../models/observation';

// What the page shows, without refs or ids: equal fingerprints mean an action changed nothing.
export function fingerprint(observation: Observation): string {
  return JSON.stringify({
    url: observation.url,
    frames: observation.frames.map((frame) => [frame.name, frame.url]),
    nodes: observation.nodes.map((node) => [node.frame, node.role, node.name, node.label, node.value, node.checked, node.disabled]),
    dialog: observation.dialog,
  });
}

// A read progresses by capturing a value it had not captured; any other action by changing the page.
export function progressed(before: Observation, after: Observation, capturedNewValue: boolean): boolean {
  return capturedNewValue || fingerprint(before) !== fingerprint(after);
}

// Declared outputs not captured yet; the goal holds when there are none (RFC-003).
export function missingOutputs(request: CapabilityRequest, captured: Readonly<Record<string, string>>): string[] {
  return Object.keys(request.outputs).filter((name) => !Object.hasOwn(captured, name));
}

// Why the previous answer did not advance the run.
export type Setback =
  | { readonly kind: 'no_progress'; readonly decision: AgentDecision; readonly node?: ObservationNode }
  | { readonly kind: 'unknown_ref'; readonly decision: AgentDecision }
  | { readonly kind: 'denied'; readonly decision: AgentDecision; readonly node?: ObservationNode; readonly reason: string }
  | { readonly kind: 'action_failed'; readonly decision: AgentDecision; readonly node?: ObservationNode; readonly detail: string }
  | { readonly kind: 'unknown_output'; readonly decision: AgentDecision; readonly outputs: readonly string[] }
  | { readonly kind: 'goal_not_met'; readonly missing: readonly string[] }
  | { readonly kind: 'no_elements' }
  // A human took over and handed back the page as it was (RFC-003).
  | { readonly kind: 'human_declined' };

// Refs change with every observation, so the element is named by what it shows.
function describeAction(decision: AgentDecision, node: ObservationNode | undefined): string {
  if (node === undefined) return decision.target === null ? decision.verb : `${decision.verb} on ${decision.target}`;
  const text = node.name !== '' ? node.name : (node.label ?? '');
  return `${decision.verb} on ${node.role}${text === '' ? '' : ` ${JSON.stringify(text)}`}`;
}

// One line for the next reasoner call.
export function feedbackFor(setback: Setback): string {
  switch (setback.kind) {
    case 'no_progress':
      return `your previous ${describeAction(setback.decision, setback.node)} changed nothing`;
    case 'unknown_ref':
      return `${setback.decision.target ?? 'the target'} is not on the current screen`;
    case 'denied':
      return `your previous ${describeAction(setback.decision, setback.node)} was denied: ${setback.reason}`;
    case 'action_failed':
      return `your previous ${describeAction(setback.decision, setback.node)} failed: ${setback.detail}`;
    case 'unknown_output':
      return `${JSON.stringify(setback.decision.argument)} is not an output of the goal; read into one of: ${setback.outputs.join(', ')}`;
    case 'goal_not_met':
      return `the goal is not complete: not read yet: ${setback.missing.join(', ')}`;
    case 'no_elements':
      return 'the screen had no elements to act on';
    case 'human_declined':
      return 'a human took over and handed the screen back unchanged, declining what was asked; choose another way';
    default: {
      const unhandled: never = setback;
      return unhandled;
    }
  }
}

export type LoopState = {
  // Model turns taken so far.
  readonly steps: number;
  readonly stalls: number;
  readonly startedAt: number;
};

export type StopDecision =
  | { readonly kind: 'continue' }
  | { readonly kind: 'fail'; readonly reason: 'step_budget' | 'timeout'; readonly message: string }
  | { readonly kind: 'escalate'; readonly reason: 'stalled'; readonly message: string };

// Checked before each turn.
export function stopCheck(state: LoopState, limits: DiscoveryLimits, now: number): StopDecision {
  if (state.stalls >= limits.maxStalls) {
    return { kind: 'escalate', reason: 'stalled', message: `${String(state.stalls)} steps in a row made no progress` };
  }
  if (state.steps >= limits.maxSteps) {
    return { kind: 'fail', reason: 'step_budget', message: `the goal was not met within ${String(limits.maxSteps)} steps` };
  }
  if (now - state.startedAt >= limits.timeoutMs) {
    return { kind: 'fail', reason: 'timeout', message: `the goal was not met within ${String(limits.timeoutMs)} ms` };
  }
  return { kind: 'continue' };
}
