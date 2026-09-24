import { z } from 'zod';
import type { SurfaceDecision } from './action';
import { ReasonerInfoSchema } from './capability';
import type { ElementDescriptor } from './element-descriptor';
import { EscalationReasonSchema } from './execution-result';
import type { HumanAction } from './intervention';
import type { Observation, ObservationNode } from './observation';

// One action the model had performed on the surface. Observations are the redacted ones the
// model saw (RFC-006); the synthesizer builds the artifact from the trace alone.
export type AgentTraceStep = {
  readonly actor: 'agent';
  readonly stepId: string;
  readonly decision: SurfaceDecision;
  readonly observation: Observation;
  // The element the decision's action.ref named: its node in `observation` and its descriptor.
  readonly element?: { readonly node: ObservationNode; readonly descriptor: ElementDescriptor };
  readonly observationAfter: Observation;
  readonly progressed: boolean;
};

// One action a human performed during a handoff; the observations are those around the handoff.
export type HumanTraceStep = {
  readonly actor: 'human';
  readonly stepId: string;
  readonly interventionId: string;
  readonly action: HumanAction;
  // The element of `observation` the human clicked, when it could be matched.
  readonly element?: { readonly node: ObservationNode; readonly descriptor: ElementDescriptor };
  readonly observation: Observation;
  readonly observationAfter: Observation;
};

export type TraceStep = AgentTraceStep | HumanTraceStep;

// What the model provider said about the call that produced a decision, when it said it: shows
// the discovery evidence came from a real model. Ollama's durations are in nanoseconds.
export type ProviderMeta =
  | {
      readonly provider: 'ollama';
      readonly model?: string;
      readonly createdAt?: string;
      readonly totalDurationNs?: number;
      readonly evalCount?: number;
      readonly promptEvalCount?: number;
    }
  | {
      readonly provider: 'openai-compatible';
      readonly id?: string;
      readonly model?: string;
      readonly usage?: { readonly promptTokens?: number; readonly completionTokens?: number; readonly totalTokens?: number };
    };

export type DiscoveryLimits = {
  readonly maxSteps: number;
  // Time the loop may run, not counting time spent waiting on a human in a handoff.
  readonly timeoutMs: number;
  // Consecutive steps without progress (unchanged page, rejected ref, denial) before escalating.
  readonly maxStalls: number;
};

// RFC-003 defaults; the wall-clock budget is generous because local models are slow.
export const DEFAULT_DISCOVERY_LIMITS: DiscoveryLimits = { maxSteps: 25, timeoutMs: 600_000, maxStalls: 3 };

export const DISCOVERY_FAILURE_REASONS = [
  'artifact_exists',
  'precondition_failed',
  'policy_denied',
  'step_budget',
  'timeout',
  'reasoner_exhausted',
  'synthesis_failed',
  'artifact_invalid',
  'driver_error',
] as const;

const base = {
  // Name of the run's evidence folder.
  runId: z.string(),
  capability: z.strictObject({ id: z.string(), version: z.string() }),
  reasoner: ReasonerInfoSchema,
  durationMs: z.number().nonnegative(),
  // Model turns taken.
  steps: z.number().int().nonnegative(),
  // Ids of the human handoffs of the run.
  interventions: z.array(z.string()),
};

export const DiscoveryResultSchema = z.discriminatedUnion('status', [
  // The artifact is published as `capability` in the artifact store.
  z.strictObject({
    ...base,
    status: z.literal('succeeded'),
    // Values read with the examples; masked in evidence like any declared-sensitive output.
    outputs: z.record(z.string(), z.string()),
  }),
  z.strictObject({ ...base, status: z.literal('failed'), reason: z.enum(DISCOVERY_FAILURE_REASONS), message: z.string() }),
  z.strictObject({
    ...base,
    status: z.literal('escalated'),
    interventionId: z.string(),
    reason: EscalationReasonSchema,
    stepId: z.string(),
    message: z.string(),
  }),
]);

export type DiscoveryFailureReason = (typeof DISCOVERY_FAILURE_REASONS)[number];
export type DiscoveryResult = z.infer<typeof DiscoveryResultSchema>;
