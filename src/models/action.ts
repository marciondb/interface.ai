import { z } from 'zod';
import { RefSchema } from './observation';

export const VERBS = ['click', 'fill', 'select', 'press', 'navigate', 'read', 'finish', 'request_help'] as const;

export const VerbSchema = z.enum(VERBS);

export type Verb = z.infer<typeof VerbSchema>;

type Rule = 'required' | 'optional' | 'forbidden';

export const VERB_RULES = {
  click: { target: 'required', argument: 'forbidden' },
  fill: { target: 'required', argument: 'required' },
  select: { target: 'required', argument: 'required' },
  press: { target: 'optional', argument: 'required' },
  navigate: { target: 'forbidden', argument: 'required' },
  read: { target: 'required', argument: 'required' },
  finish: { target: 'forbidden', argument: 'optional' },
  request_help: { target: 'forbidden', argument: 'required' },
} as const satisfies Record<Verb, { target: Rule; argument: Rule }>;

// argument: fill value, select option label, press key, navigate URL,
// read output name, finish summary, request_help reason.
export const ActionFieldsSchema = z.strictObject({
  verb: VerbSchema,
  target: RefSchema.nullable(),
  argument: z.string().nullable(),
  rationale: z.string().min(1),
});

export const ActionSchema = ActionFieldsSchema.superRefine((action, ctx) => {
  for (const field of ['target', 'argument'] as const) {
    const rule: Rule = VERB_RULES[action.verb][field];
    const present = action[field] !== null;
    if (rule === 'required' && !present) {
      ctx.addIssue({ code: 'custom', message: `${action.verb} requires ${field}`, path: [field] });
    }
    if (rule === 'forbidden' && present) {
      ctx.addIssue({ code: 'custom', message: `${action.verb} does not take ${field}`, path: [field] });
    }
  }
});

export type Action = z.infer<typeof ActionSchema>;

export type AgentDecision = Action;
