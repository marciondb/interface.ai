import { z } from 'zod';

// Schema version 1: exactly these sections (RFC-002). Their contents stay untrusted here and are
// validated once, by the capability model in the adapter, so the rules live in one place.
export const CapabilityFileInSchema = z.strictObject({
  schemaVersion: z.literal(1),
  status: z.unknown().optional(),
  capability: z.unknown(),
  preconditions: z.unknown(),
  inputs: z.unknown(),
  outputs: z.unknown(),
  targets: z.unknown(),
  steps: z.unknown(),
  outcomes: z.unknown(),
  provenance: z.unknown(),
  notes: z.unknown().optional(),
});

export type CapabilityFileIn = z.infer<typeof CapabilityFileInSchema>;
