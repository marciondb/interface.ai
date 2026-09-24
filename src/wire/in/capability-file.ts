import { z } from 'zod';

// Envelope only: sections stay untrusted here and are validated by the capability model.
export const CapabilityFileInSchema = z.looseObject({
  schemaVersion: z.literal(1),
});

export type CapabilityFileIn = z.infer<typeof CapabilityFileInSchema>;
