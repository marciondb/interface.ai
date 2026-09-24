import { z } from 'zod';

export const RefSchema = z.string().regex(/^e[0-9]+$/, 'ref must look like e12');

export const ObservationNodeSchema = z.object({
  // Absent for context-only nodes (plain text): visible to the model, not targetable.
  ref: RefSchema.optional(),
  role: z.string(),
  name: z.string(),
  // Adjacent visible text for controls with no accessible name (ADR-005).
  label: z.string().optional(),
  value: z.string().optional(),
  checked: z.boolean().optional(),
  disabled: z.boolean().optional(),
  // Frame name; null is the top-level document.
  frame: z.string().nullable(),
});

export const FrameSchema = z.object({
  name: z.string().nullable(),
  url: z.string(),
});

export const DialogSchema = z.object({
  type: z.enum(['alert', 'confirm', 'prompt', 'beforeunload']),
  message: z.string(),
});

export const ObservationSchema = z
  .object({
    // Monotonic per session; refs are valid only for the observation that issued them.
    observationId: z.number().int().nonnegative(),
    url: z.string(),
    frames: z.array(FrameSchema),
    nodes: z.array(ObservationNodeSchema),
    dialog: DialogSchema.nullable(),
  })
  .superRefine((observation, ctx) => {
    const seen = new Set<string>();
    observation.nodes.forEach((node, index) => {
      if (node.ref === undefined) return;
      if (seen.has(node.ref)) {
        ctx.addIssue({ code: 'custom', message: `duplicate ref ${node.ref}`, path: ['nodes', index, 'ref'] });
      }
      seen.add(node.ref);
    });
  });

export type Ref = z.infer<typeof RefSchema>;
export type ObservationNode = z.infer<typeof ObservationNodeSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type Dialog = z.infer<typeof DialogSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
