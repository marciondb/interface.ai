import { z } from 'zod';
import type { EscalationReason } from './execution-result';

// Why automation stopped and asked for a human (RFC-005 triggers).
export const InterventionReasonSchema = z.enum(['risky_action', 'stalled', 'help_requested']);

// Written to intervention.json and shown to the operator (RFC-005).
export const InterventionRequestSchema = z.strictObject({
  interventionId: z.string(),
  runId: z.string(),
  mode: z.enum(['replay', 'discovery']),
  // `id@version`, when the run has one.
  capability: z.string().optional(),
  goal: z.string().optional(),
  stepId: z.string(),
  reason: InterventionReasonSchema,
  message: z.string(),
  // Relative to the run folder; null when the page could not be photographed.
  screenshot: z.string().nullable(),
  url: z.string(),
  requestedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

// What a human typed never leaves the page: the capture sends this instead.
export const HUMAN_INPUT_MASK = '[redacted]';

// The element a human acted on, as the page described it.
export const HumanTargetSchema = z.strictObject({
  // Frame name; null is the top-level document.
  frame: z.string().nullable(),
  tag: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),
  id: z.string().optional(),
  nameAttr: z.string().optional(),
});

export const HumanActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('click'), target: HumanTargetSchema, at: z.iso.datetime() }),
  z.strictObject({ kind: z.literal('input'), target: HumanTargetSchema, value: z.literal(HUMAN_INPUT_MASK), at: z.iso.datetime() }),
  // Origin and path only: the query string may carry what was typed.
  z.strictObject({ kind: z.literal('navigation'), frame: z.string().nullable(), url: z.string(), at: z.iso.datetime() }),
  // A native dialog the operator answered at the terminal.
  z.strictObject({ kind: z.literal('dialog'), message: z.string(), decision: z.enum(['accept', 'dismiss']), at: z.iso.datetime() }),
]);

export type InterventionReason = z.infer<typeof InterventionReasonSchema>;
export type InterventionRequest = z.infer<typeof InterventionRequestSchema>;
export type HumanTarget = z.infer<typeof HumanTargetSchema>;
export type HumanAction = z.infer<typeof HumanActionSchema>;
export type DialogDecision = Extract<HumanAction, { kind: 'dialog' }>['decision'];

export type HandoffOutcome =
  | {
      readonly status: 'resumed';
      readonly interventionId: string;
      readonly by: string;
      readonly at: string;
      readonly actions: readonly HumanAction[];
    }
  | {
      readonly status: 'aborted';
      readonly interventionId: string;
      readonly cause: EscalationReason;
      readonly at: string;
      readonly actions: readonly HumanAction[];
    };
