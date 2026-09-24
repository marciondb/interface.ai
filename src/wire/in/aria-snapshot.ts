import { z } from 'zod';

// Playwright aria snapshot, JSON form, AI mode (`page.ariaSnapshotJSON({ mode: 'ai' })`).
// A node is either plain text or an element; iframe content is nested under the iframe node.
export const AriaElementSchema = z.looseObject({
  role: z.string(),
  name: z.string().optional(),
  ref: z.string().optional(),
  // Own text: the typed value of a textbox, or the text of a generic element.
  text: z.string().optional(),
  url: z.string().optional(),
  checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
  disabled: z.boolean().optional(),
  get children(): z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, typeof AriaElementSchema]>>> {
    return z.array(z.union([z.string(), AriaElementSchema])).optional();
  },
});

export const AriaNodeSchema = z.union([z.string(), AriaElementSchema]);

// Envelope built by the driver: top URL, child frames in document order, snapshot roots.
export const AriaSnapshotWireSchema = z.object({
  url: z.string(),
  frames: z.array(z.object({ name: z.string(), url: z.string() })),
  nodes: z.array(AriaNodeSchema),
});

export type AriaElement = z.infer<typeof AriaElementSchema>;
export type AriaNode = z.infer<typeof AriaNodeSchema>;
export type AriaSnapshotWire = z.infer<typeof AriaSnapshotWireSchema>;
