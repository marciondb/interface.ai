import { z } from 'zod';

// policy.json (RFC-006). Loose: sections other layers add later are ignored here.
// `risky` is required so a policy without risk rules fails closed.
export const PolicyFileInSchema = z.looseObject({
  allowedOrigins: z.array(z.string()),
  allowedRoutes: z.array(z.string()),
  allowedActions: z.array(z.string()),
  risky: z.strictObject({
    routes: z.array(z.string()),
    controlText: z.array(z.string()),
  }),
});

export type PolicyFileIn = z.infer<typeof PolicyFileInSchema>;
