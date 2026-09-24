import { z } from 'zod';
import type { AgentDecision } from './action';
import type { ElementDescriptor } from './element-descriptor';
import type { Observation, ObservationNode } from './observation';

// One action discovery performed on the surface. Observations are the redacted ones the
// model saw (RFC-006); the synthesizer builds the artifact from these alone.
export type TraceStep = {
  readonly stepId: string;
  readonly decision: AgentDecision;
  readonly observation: Observation;
  // The element decision.target named: its node in `observation` and its descriptor.
  readonly element?: { readonly node: ObservationNode; readonly descriptor: ElementDescriptor };
  // The value a `read` captured.
  readonly value?: string;
  readonly observationAfter: Observation;
  readonly progressed: boolean;
};

export type DiscoveryLimits = {
  readonly maxSteps: number;
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

export const DISCOVERY_ESCALATION_REASONS = ['stalled', 'help_requested', 'risky_action'] as const;

const base = {
  // Name of the run's evidence folder.
  runId: z.string(),
  capability: z.strictObject({ id: z.string(), version: z.string() }),
  reasoner: z.strictObject({ adapter: z.enum(['local', 'hosted']), model: z.string() }),
  durationMs: z.number().nonnegative(),
  // Model turns taken.
  steps: z.number().int().nonnegative(),
};

export const DiscoveryResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ...base,
    status: z.literal('succeeded'),
    artifactPath: z.string(),
    // Values read with the examples; masked in evidence like any declared-sensitive output.
    outputs: z.record(z.string(), z.string()),
  }),
  z.strictObject({ ...base, status: z.literal('failed'), reason: z.enum(DISCOVERY_FAILURE_REASONS), message: z.string() }),
  z.strictObject({
    ...base,
    status: z.literal('escalated'),
    reason: z.enum(DISCOVERY_ESCALATION_REASONS),
    stepId: z.string(),
    message: z.string(),
  }),
]);

export type DiscoveryFailureReason = (typeof DISCOVERY_FAILURE_REASONS)[number];
export type DiscoveryEscalationReason = (typeof DISCOVERY_ESCALATION_REASONS)[number];
export type DiscoveryResult = z.infer<typeof DiscoveryResultSchema>;
