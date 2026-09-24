import { z } from 'zod';
import { SemverSchema } from './capability';
import { DialogSchema } from './observation';

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

const recoveryBase = { stepId: z.string(), attempt: z.number().int().positive() };

// What was recovered from and how (RFC-004): a declared recoverable outcome by its recovery
// or a retry, a timeout by a retry, an expired session by signing in again, and a native dialog
// automation dismissed while the step's checkpoint still held.
export const RecoverySchema = z.discriminatedUnion('condition', [
  z.strictObject({ ...recoveryBase, condition: z.literal('outcome'), outcomeId: z.string(), response: z.enum(['declared_recovery', 'retry']) }),
  z.strictObject({ ...recoveryBase, condition: z.literal('timeout'), response: z.literal('retry') }),
  z.strictObject({ ...recoveryBase, condition: z.literal('session_expired'), response: z.literal('reauthenticate') }),
  z.strictObject({ stepId: z.string(), condition: z.literal('unexpected_dialog'), response: z.literal('dismissed'), dialog: DialogSchema }),
]);

// How the human handoff ended without the run resuming (RFC-005); what triggered it is in the
// intervention request and the message.
export const EscalationReasonSchema = z.enum(['no_operator_surface', 'aborted', 'ttl_expired', 'surface_closed']);

const base = {
  // Name of the run's evidence folder.
  runId: z.string(),
  // `version` is the loaded artifact's; absent when no artifact could be loaded.
  capability: z.strictObject({ id: z.string(), requestedMajor: z.number().int().nonnegative(), version: SemverSchema.optional() }),
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
      // Failure screenshot, else failure snapshot, else the run's evidence folder ('.'); relative to that folder.
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
