import { z } from 'zod';

// `values` of node:util parseArgs for the replay command.
export const ReplayArgsInSchema = z.object({
  capability: z.string().optional(),
  input: z.array(z.string()).optional(),
  target: z.string().optional(),
  headed: z.boolean().optional(),
});

export type ReplayArgsIn = z.infer<typeof ReplayArgsInSchema>;
