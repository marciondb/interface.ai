import { z } from 'zod';

// `values` of node:util parseArgs for the discover command.
export const DiscoverArgsInSchema = z.object({
  request: z.string().optional(),
  goal: z.string().optional(),
  capability: z.string().optional(),
  input: z.array(z.string()).optional(),
  output: z.array(z.string()).optional(),
  outcome: z.array(z.string()).optional(),
  version: z.string().optional(),
  reasoner: z.string().optional(),
  target: z.string().optional(),
  headed: z.boolean().optional(),
});

export type DiscoverArgsIn = z.infer<typeof DiscoverArgsInSchema>;
