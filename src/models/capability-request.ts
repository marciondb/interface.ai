import { z } from 'zod';
import { CapabilityInfoSchema, FieldNameSchema, InputSpecSchema, OutputSpecSchema } from './capability';

export const GOAL_PARAMETER = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

// An input as the artifact declares it, plus the value used during the discovery run.
export const RequestInputSchema = InputSpecSchema.extend({ example: z.string().min(1) });

// What discovery should learn (RFC-003): the goal, the contract of the capability it produces,
// and which of the app's catalogued outcomes apply to it.
export const CapabilityRequestSchema = z.strictObject({
  capability: CapabilityInfoSchema,
  // Template with {{input}} placeholders, rendered with the examples.
  goal: z.string().min(1),
  inputs: z.record(FieldNameSchema, RequestInputSchema),
  outputs: z.record(FieldNameSchema, OutputSpecSchema).refine((outputs) => Object.keys(outputs).length > 0, 'declare at least one output'),
  // Outcome ids from discovery/catalogs/<product>.json.
  outcomes: z.array(z.string().min(1)),
});

export type RequestInput = z.infer<typeof RequestInputSchema>;
export type CapabilityRequest = z.infer<typeof CapabilityRequestSchema>;
