import { z } from 'zod';

// discovery/requests/<id>.json. Envelope only: the content is validated by the request model.
export const CapabilityRequestFileInSchema = z.looseObject({
  schemaVersion: z.literal(1),
});

export type CapabilityRequestFileIn = z.infer<typeof CapabilityRequestFileInSchema>;
