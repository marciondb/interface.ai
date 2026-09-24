import { z } from 'zod';
import { RefSchema, type Ref } from './observation';

// What the surface executes. A ref comes from the latest observation or a later resolve().
export type SurfaceAction =
  | { readonly kind: 'click'; readonly ref: Ref }
  | { readonly kind: 'fill'; readonly ref: Ref; readonly value: string }
  // option: the label of the option to choose.
  | { readonly kind: 'select'; readonly ref: Ref; readonly option: string }
  | { readonly kind: 'press'; readonly ref: Ref; readonly key: string }
  | { readonly kind: 'navigate'; readonly url: string }
  // Changes nothing: captures the element's form value or text.
  | { readonly kind: 'read'; readonly ref: Ref };

export type SurfaceActionKind = SurfaceAction['kind'];
export type PageAction = Exclude<SurfaceAction, { readonly kind: 'read' }>;
export type ReadAction = Extract<SurfaceAction, { readonly kind: 'read' }>;

export const SURFACE_ACTION_KINDS = ['click', 'fill', 'select', 'press', 'navigate', 'read'] as const satisfies readonly SurfaceActionKind[];

// What the model decided in one discovery turn (RFC-003); `output` names what a read captures.
export type AgentDecision =
  | { readonly kind: 'act'; readonly action: PageAction; readonly rationale: string }
  | { readonly kind: 'read'; readonly action: ReadAction; readonly output: string; readonly rationale: string }
  | { readonly kind: 'finish'; readonly summary: string | null; readonly rationale: string }
  | { readonly kind: 'request_help'; readonly message: string; readonly rationale: string };

// A decision that acts on the surface.
export type SurfaceDecision = Extract<AgentDecision, { readonly action: SurfaceAction }>;

export const VERBS = [...SURFACE_ACTION_KINDS, 'finish', 'request_help'] as const;

export const VerbSchema = z.enum(VERBS);

export type Verb = z.infer<typeof VerbSchema>;

// The flat JSON object the model fills each turn, kept flat for constrained decoding (ADR-015).
// argument: fill value, select option label, press key, navigate URL, read output name,
// finish summary, request_help reason. Which verb takes which field is checked when it is
// turned into an AgentDecision.
export const ModelStepSchema = z.strictObject({
  verb: VerbSchema,
  target: RefSchema.nullable(),
  argument: z.string().nullable(),
  rationale: z.string().min(1),
});

export type ModelStep = z.infer<typeof ModelStepSchema>;
