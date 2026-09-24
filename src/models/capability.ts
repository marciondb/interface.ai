import { z } from 'zod';

export const CapabilityIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, 'capability id must look like member.read-account-balance');

export const SemverSchema = z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'version must be semver MAJOR.MINOR.PATCH');

export const FieldNameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/, 'field names must be alphanumeric identifiers');

export const TargetNameSchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/, 'target names must be dotted identifiers like lookup.memberId');

const StepIdSchema = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'step ids must be kebab-case');

const OutcomeIdSchema = z.string().regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, 'outcome ids must be snake_case');

export const PLACEHOLDER = /\{\{inputs\.([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

export const SENSITIVITIES = ['none', 'internal', 'pii', 'financial'] as const;

export const SensitivitySchema = z.enum(SENSITIVITIES, {
  error: (issue) => (issue.input === 'secret' ? 'secret fields are not allowed (ADR-013)' : undefined),
});

export const FieldTypeSchema = z.enum(['string', 'number']);

export const CapabilityInfoSchema = z.strictObject({
  id: CapabilityIdSchema,
  version: SemverSchema,
  description: z.string().min(1),
  app: z.strictObject({ product: z.string().min(1), surface: z.literal('web') }),
});

export const PreconditionSchema = z.strictObject({ kind: z.literal('authenticated_session') });

// pattern is an ECMAScript regex tested against the raw value; include anchors for a full match.
export const InputSpecSchema = z.strictObject({
  type: FieldTypeSchema,
  description: z.string().min(1),
  pattern: z.string().optional(),
  enum: z.array(z.string()).min(1).optional(),
  sensitivity: SensitivitySchema,
});

export const OutputSpecSchema = z.strictObject({
  type: FieldTypeSchema,
  description: z.string().min(1),
  sensitivity: SensitivitySchema,
});

// Locator candidates, most semantic first (ADR-008). A candidate counts only on exactly one match.
export const CandidateSchema = z.discriminatedUnion('strategy', [
  z.strictObject({ strategy: z.literal('role'), role: z.string().min(1), name: z.string().min(1) }),
  // Visible text adjacent to a control that has no accessible name (ADR-005).
  z.strictObject({ strategy: z.literal('label'), text: z.string().min(1) }),
  z.strictObject({ strategy: z.literal('attribute'), name: z.string().min(1), value: z.string().min(1) }),
  z.strictObject({ strategy: z.literal('text'), text: z.string().min(1) }),
  // The cell in `column` of the row whose `row.column` cell equals `row.equals`;
  // with `role`, the element of that role inside the cell.
  z.strictObject({
    strategy: z.literal('table_cell'),
    row: z.strictObject({ column: z.string().min(1), equals: z.string().min(1) }),
    column: z.string().min(1),
    role: z.string().min(1).optional(),
  }),
]);

export const TargetSpecSchema = z.strictObject({
  // Frame name; absent means the top-level document.
  frame: z.string().min(1).optional(),
  candidates: z.array(CandidateSchema).min(1),
  notes: z.string().optional(),
});

// A target's value is the form value for form controls, otherwise the element's text.
export const PredicateSchema = z.discriminatedUnion('kind', [
  // Substring of the visible text; without `frame`, any frame.
  z.strictObject({ kind: z.literal('text_visible'), text: z.string().min(1), frame: z.string().min(1).optional() }),
  z.strictObject({ kind: z.literal('target_visible'), target: TargetNameSchema }),
  z.strictObject({ kind: z.literal('value_equals'), target: TargetNameSchema, value: z.string() }),
  z.strictObject({ kind: z.literal('value_matches'), target: TargetNameSchema, pattern: z.string().min(1) }),
]);

const ClickActionSchema = z.strictObject({ kind: z.literal('click'), target: TargetNameSchema });

export const StepActionSchema = z.discriminatedUnion('kind', [
  ClickActionSchema,
  z.strictObject({ kind: z.literal('fill'), target: TargetNameSchema, value: z.string() }),
  z.strictObject({ kind: z.literal('select'), target: TargetNameSchema, value: z.string().min(1) }),
  z.strictObject({ kind: z.literal('press'), target: TargetNameSchema, key: z.string().min(1) }),
  // Path relative to the target application's origin.
  z.strictObject({ kind: z.literal('navigate'), path: z.string().startsWith('/') }),
  z.strictObject({ kind: z.literal('read'), target: TargetNameSchema, output: FieldNameSchema }),
]);

export const RiskSchema = z.enum(['safe', 'risky']);

export const StepSchema = z.strictObject({
  id: StepIdSchema,
  action: StepActionSchema,
  risk: RiskSchema,
  checkpoint: PredicateSchema,
  notes: z.string().optional(),
});

export const OutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: OutcomeIdSchema,
    kind: z.literal('business'),
    description: z.string().optional(),
    when: PredicateSchema,
  }),
  z.strictObject({
    id: OutcomeIdSchema,
    kind: z.literal('recoverable'),
    description: z.string().optional(),
    when: PredicateSchema,
    recover: ClickActionSchema.optional(),
  }),
]);

// Which model discovered an artifact: local (Ollama) or hosted (OpenAI-compatible).
export const ReasonerInfoSchema = z.strictObject({ adapter: z.enum(['local', 'hosted']), model: z.string().min(1) });

export const ProvenanceSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('hand_written'), createdAt: z.iso.datetime() }),
  z.strictObject({
    method: z.literal('discovered'),
    createdAt: z.iso.datetime(),
    // Discovery run id; its evidence lives under evidence/runs/.
    runId: z.string().min(1),
    reasoner: ReasonerInfoSchema,
  }),
]);

export const CapabilitySchema = z
  .strictObject({
    capability: CapabilityInfoSchema,
    preconditions: z.array(PreconditionSchema),
    inputs: z.record(FieldNameSchema, InputSpecSchema),
    outputs: z.record(FieldNameSchema, OutputSpecSchema),
    targets: z.record(TargetNameSchema, TargetSpecSchema),
    steps: z.array(StepSchema).min(1),
    outcomes: z.array(OutcomeSchema),
    provenance: ProvenanceSchema,
    notes: z.string().optional(),
  })
  .superRefine((capability, ctx) => {
    const issue = (path: (string | number)[], message: string) => {
      ctx.addIssue({ code: 'custom', path, message });
    };

    for (const [name, input] of Object.entries(capability.inputs)) {
      const path = ['inputs', name];
      if (input.type !== 'string' && (input.pattern !== undefined || input.enum !== undefined)) {
        issue(path, `${input.type} inputs cannot declare pattern or enum`);
      }
      const pattern = input.pattern === undefined ? undefined : compile(input.pattern);
      if (pattern === null) issue([...path, 'pattern'], 'pattern is not a valid regular expression');
      if (input.enum !== undefined && new Set(input.enum).size !== input.enum.length) {
        issue([...path, 'enum'], 'enum values must be unique');
      }
      input.enum?.forEach((value, index) => {
        if (pattern?.test(value) === false) issue([...path, 'enum', index], `enum value does not match pattern`);
      });
    }

    const targetExists = (target: string, path: (string | number)[]) => {
      if (!Object.hasOwn(capability.targets, target)) issue(path, `unknown target ${target}`);
    };
    const checkPredicate = (predicate: Predicate, path: (string | number)[]) => {
      const target = predicateTarget(predicate);
      if (target !== undefined) targetExists(target, [...path, 'target']);
      if (predicate.kind === 'value_matches' && compile(predicate.pattern) === null) {
        issue([...path, 'pattern'], 'pattern is not a valid regular expression');
      }
    };

    const stepIds = new Set<string>();
    const producers = new Map<string, number>();
    capability.steps.forEach((step, index) => {
      const path = ['steps', index];
      if (stepIds.has(step.id)) issue([...path, 'id'], `duplicate step id ${step.id}`);
      stepIds.add(step.id);
      const target = actionTarget(step.action);
      if (target !== undefined) targetExists(target, [...path, 'action', 'target']);
      checkPredicate(step.checkpoint, [...path, 'checkpoint']);
      if (step.action.kind === 'read') {
        const { output } = step.action;
        if (!Object.hasOwn(capability.outputs, output)) issue([...path, 'action', 'output'], `undeclared output ${output}`);
        producers.set(output, (producers.get(output) ?? 0) + 1);
      }
    });
    for (const output of Object.keys(capability.outputs)) {
      const count = producers.get(output) ?? 0;
      if (count !== 1) issue(['outputs', output], `output must be produced by exactly one read step, found ${String(count)}`);
    }

    const outcomeIds = new Set<string>();
    capability.outcomes.forEach((outcome, index) => {
      const path = ['outcomes', index];
      if (outcomeIds.has(outcome.id)) issue([...path, 'id'], `duplicate outcome id ${outcome.id}`);
      outcomeIds.add(outcome.id);
      checkPredicate(outcome.when, [...path, 'when']);
      if (outcome.kind === 'recoverable' && outcome.recover !== undefined) {
        targetExists(outcome.recover.target, [...path, 'recover', 'target']);
      }
    });

    for (const section of ['targets', 'steps', 'outcomes'] as const) {
      for (const [path, text] of strings(capability[section], [section])) {
        for (const [, name] of text.matchAll(PLACEHOLDER)) {
          if (!Object.hasOwn(capability.inputs, name)) issue(path, `placeholder names undeclared input ${name}`);
        }
        const rest = text.replace(PLACEHOLDER, '');
        if (rest.includes('{{') || rest.includes('}}')) issue(path, 'placeholders must look like {{inputs.<name>}}');
      }
    }
  });

function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function strings(value: unknown, path: (string | number)[]): [(string | number)[], string][] {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => strings(item, [...path, index]));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => strings(item, [...path, key]));
  }
  return [];
}

export function actionTarget(action: StepAction): string | undefined {
  switch (action.kind) {
    case 'click':
    case 'fill':
    case 'select':
    case 'press':
    case 'read':
      return action.target;
    case 'navigate':
      return undefined;
    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}

export function predicateTarget(predicate: Predicate): string | undefined {
  switch (predicate.kind) {
    case 'target_visible':
    case 'value_equals':
    case 'value_matches':
      return predicate.target;
    case 'text_visible':
      return undefined;
    default: {
      const unhandled: never = predicate;
      return unhandled;
    }
  }
}

export type Sensitivity = z.infer<typeof SensitivitySchema>;
export type FieldType = z.infer<typeof FieldTypeSchema>;
export type CapabilityInfo = z.infer<typeof CapabilityInfoSchema>;
export type Precondition = z.infer<typeof PreconditionSchema>;
export type InputSpec = z.infer<typeof InputSpecSchema>;
export type OutputSpec = z.infer<typeof OutputSpecSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type TargetSpec = z.infer<typeof TargetSpecSchema>;
export type Predicate = z.infer<typeof PredicateSchema>;
export type StepAction = z.infer<typeof StepActionSchema>;
export type Risk = z.infer<typeof RiskSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type ReasonerInfo = z.infer<typeof ReasonerInfoSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
