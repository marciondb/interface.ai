import { z } from 'zod';

// policy.json (RFC-006). Loose: sections other layers add later are ignored here.
export const PolicyFileInSchema = z.looseObject({
  allowedOrigins: z.array(z.string()),
  allowedRoutes: z.array(z.string()),
  allowedActions: z.array(z.string()),
});

export type PolicyFileIn = z.infer<typeof PolicyFileInSchema>;
