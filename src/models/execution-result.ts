import { z } from 'zod';

export const FAILURE_CODES = [
  'invalid_input',
  'artifact_unavailable',
  'precondition_failed',
  'policy_denied',
  'target_not_found',
  'target_ambiguous',
  'timeout',
  'session_expired',
  'server_error',
  'recovery_exhausted',
  'checkpoint_failed',
  'driver_error',
] as const;

export const FailureCodeSchema = z.enum(FAILURE_CODES);

export const RecoverySchema = z.strictObject({
  stepId: z.string(),
  // Declared recoverable outcome id, `timeout` or `session_expired`.
  condition: z.string(),
  response: z.enum(['declared_recovery', 'retry', 'reauthenticate']),
  attempt: z.number().int().positive(),
});

// How the human handoff ended without the run resuming (RFC-005); what triggered it is in the
// intervention request and the message.
export const EscalationReasonSchema = z.enum(['no_operator_surface', 'aborted', 'ttl_expired', 'surface_closed']);

const base = {
  // Name of the run's evidence folder.
  runId: z.string(),
  // Resolved version, or the requested major when the artifact could not be loaded.
  capability: z.strictObject({ id: z.string(), version: z.string() }),
  durationMs: z.number().nonnegative(),
  recoveries: z.array(RecoverySchema),
  interventions: z.array(z.string()),
};

// ADR-009: business outcomes, failures and escalations are distinct types, never variations of an error.
export const ExecutionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...base, status: z.literal('succeeded'), outputs: z.record(z.string(), z.string()) }),
  z.strictObject({
    ...base,
    status: z.literal('business_outcome'),
    outcome: z.string(),
    details: z.strictObject({ stepId: z.string() }),
  }),
  z.strictObject({
    ...base,
    status: z.literal('failed'),
    failure: z.strictObject({
      stepId: z.string(),
      code: FailureCodeSchema,
      expected: z.string(),
      observed: z.string(),
      // Failure screenshot, else failure snapshot, else the run's evidence folder.
      evidence: z.string(),
    }),
  }),
  z.strictObject({
    ...base,
    status: z.literal('escalated'),
    interventionId: z.string(),
    stepId: z.string(),
    reason: EscalationReasonSchema,
    message: z.string(),
  }),
]);

export type FailureCode = z.infer<typeof FailureCodeSchema>;
export type Recovery = z.infer<typeof RecoverySchema>;
export type EscalationReason = z.infer<typeof EscalationReasonSchema>;
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
export type ExecutionStatus = ExecutionResult['status'];
export type Failure = Extract<ExecutionResult, { status: 'failed' }>['failure'];
