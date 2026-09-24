import type { Candidate, Capability, Outcome, Predicate, Provenance, Risk, Step, StepAction, TargetSpec } from '../models/capability';
import { CapabilitySchema, PLACEHOLDER, predicateTarget } from '../models/capability';
import type { CapabilityRequest } from '../models/capability-request';
import type { AgentTraceStep, HumanTraceStep, TraceStep } from '../models/discovery';
import { outcomeTargets, type OutcomeCatalog } from '../models/outcome-catalog';
import type { Observation, ObservationNode } from '../models/observation';
import { evaluatePredicate } from './checkpoint';
import { targetNotes } from './target-notes';

export type SynthesisErrorCode =
  | 'no_steps'
  | 'untargetable_element'
  | 'no_checkpoint'
  | 'output_not_read'
  | 'input_not_used'
  | 'unsupported_human_steps'
  | 'invalid_artifact';

export type SynthesisError = {
  readonly code: SynthesisErrorCode;
  readonly message: string;
  readonly stepId?: string;
};

export type Synthesis = { readonly ok: true; readonly capability: Capability } | { readonly ok: false; readonly error: SynthesisError };

// Text left by redaction: a candidate or checkpoint built from it would never match.
const MASKED = /\[REDACTED:|\*{4}/;
// Roles whose name is layout text, not a way to address the element.
const CONTEXT_ROLES = new Set(['generic', 'text', 'cell', 'row', 'table']);
// Controls whose name is not their visible text node.
const FORM_ROLES = new Set(['textbox', 'combobox', 'searchbox', 'spinbutton', 'checkbox', 'radio', 'button']);
const MAX_NAME_WORDS = 4;

class Failure extends Error {
  constructor(readonly error: SynthesisError) {
    super(error.message);
  }
}

function fail(code: SynthesisErrorCode, message: string, stepId?: string): never {
  throw new Failure(stepId === undefined ? { code, message } : { code, message, stepId });
}

// Any value equal to an input's example becomes that input's placeholder (RFC-003).
function parameterizer(request: CapabilityRequest): (text: string) => string {
  const byExample = new Map(Object.entries(request.inputs).map(([name, input]) => [input.example, `{{inputs.${name}}}`]));
  return (text) => byExample.get(text) ?? text;
}

function words(text: string): string[] {
  if (MASKED.test(text)) return [];
  return text
    .replace(PLACEHOLDER, (_, name: string) => name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word !== '')
    .slice(0, MAX_NAME_WORDS);
}

function camel(parts: readonly string[]): string {
  const joined = parts.map((word, index) => (index === 0 ? word.toLowerCase() : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)).join('');
  return /^[a-zA-Z]/.test(joined) ? joined : `element${joined}`;
}

function kebab(parts: readonly string[]): string {
  const joined = parts.map((word) => word.toLowerCase()).join('-');
  return /^[a-z]/.test(joined) ? joined : `element-${joined}`;
}

function unique(base: string, taken: ReadonlySet<string>, separator: string): string {
  if (!taken.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}${separator}${String(index)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function strings(candidate: Candidate): string[] {
  return Object.values(candidate).flatMap((value) => (typeof value === 'string' ? [value] : Object.values(value as Record<string, string>)));
}

// The chain for one element (ADR-008). In a table row that holds an input's value, the
// element's own text is record data, so only its column in that row locates it.
function candidatesFor(element: NonNullable<AgentTraceStep['element']>, read: boolean, parameterize: (text: string) => string): Candidate[] {
  const { node, descriptor } = element;
  const { cell } = descriptor;
  const key = cell === undefined ? undefined : Object.entries(cell.row).find(([header, text]) => header !== cell.column && parameterize(text) !== text);
  let chain: Candidate[];
  if (cell !== undefined && key !== undefined) {
    chain = [
      {
        strategy: 'table_cell',
        row: { column: key[0], equals: parameterize(key[1]) },
        column: cell.column,
        ...(node.role === 'cell' ? {} : { role: node.role }),
      },
    ];
  } else {
    // A value read is data, so it never locates itself by its own text, nor by a label that
    // is record data too (the cell before it in a data row).
    const named = !read && node.name !== '' && !CONTEXT_ROLES.has(node.role);
    const label = descriptor.label === undefined ? undefined : parameterize(descriptor.label);
    const labelled = label !== undefined && !(read && label === descriptor.label && /[0-9]/.test(label));
    chain = [
      ...(named ? [{ strategy: 'role' as const, role: node.role, name: parameterize(node.name) }] : []),
      ...(labelled ? [{ strategy: 'label' as const, text: label }] : []),
      ...(descriptor.attributes.name === undefined ? [] : [{ strategy: 'attribute' as const, name: 'name', value: descriptor.attributes.name }]),
      ...(descriptor.attributes.id === undefined ? [] : [{ strategy: 'attribute' as const, name: 'id', value: descriptor.attributes.id }]),
      ...(named && !FORM_ROLES.has(node.role) ? [{ strategy: 'text' as const, text: parameterize(node.name) }] : []),
    ];
  }
  const seen = new Set<string>();
  return chain.filter((candidate) => {
    const id = JSON.stringify(candidate);
    if (seen.has(id) || strings(candidate).some((text) => MASKED.test(text))) return false;
    seen.add(id);
    return true;
  });
}

function nameWords(element: NonNullable<AgentTraceStep['element']>, spec: TargetSpec): string[] {
  const first = spec.candidates[0];
  if (first?.strategy === 'table_cell') return words(first.column);
  if (first?.strategy === 'label' && words(first.text).length > 0) return words(first.text);
  const { node, descriptor } = element;
  for (const text of [node.name, descriptor.label ?? '', descriptor.attributes.name?.split(/[$:.]/).at(-1) ?? '']) {
    const found = words(text);
    if (found.length > 0) return found;
  }
  return ['element'];
}

// The first text the action revealed: absent before, not record data (no digits), and not
// a container whose text merely concatenates other elements'.
function revealedText(before: Observation, after: Observation): ObservationNode | undefined {
  const shown = new Set(before.nodes.map((node) => node.name));
  const names = after.nodes.map((node) => node.name).filter((name) => name.trim() !== '');
  return after.nodes.find((node) => {
    const text = node.name.trim();
    if (text === '' || shown.has(node.name) || /[0-9]/.test(text) || MASKED.test(text)) return false;
    return !names.some((other) => other !== node.name && node.name.includes(other));
  });
}

function pathOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Descriptions are copied into the artifact: an example value of a sensitive input written into
// one would publish a real record's data, so it becomes the input's name.
function withoutExamples(request: CapabilityRequest): (text: string) => string {
  const sensitive = Object.entries(request.inputs).filter(([, input]) => input.sensitivity !== 'none');
  return (text) =>
    sensitive.reduce(
      (scrubbed, [name, { example }]) => scrubbed.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(example)}(?![A-Za-z0-9])`, 'g'), `<${name}>`),
      text,
    );
}

// The contract is the request's, minus the discovery examples.
function contractOf(request: CapabilityRequest): { inputs: Record<string, unknown>; outputs: Capability['outputs'] } {
  const scrub = withoutExamples(request);
  const inputs = Object.fromEntries(
    Object.entries(request.inputs).map(([name, input]) => {
      const spec: Record<string, unknown> = { ...input, description: scrub(input.description) };
      delete spec.example;
      return [name, spec];
    }),
  );
  const outputs = Object.fromEntries(Object.entries(request.outputs).map(([name, output]) => [name, { ...output, description: scrub(output.description) }]));
  return { inputs, outputs };
}

type Parameterize = (text: string) => string;

// Names the elements the steps act on: one target per distinct locator chain, each with notes
// on why its chain is robust.
function targetRegistry(parameterize: Parameterize, reserved: ReadonlySet<string>) {
  const targets: Record<string, TargetSpec> = {};
  const bySpec = new Map<string, string>();

  function locate(step: TraceStep, read: boolean): string {
    const { element } = step;
    const verb = step.actor === 'human' ? `the human's ${step.action.kind}` : step.decision.action.kind;
    if (element === undefined) return fail('untargetable_element', `${verb} has no element to locate`, step.stepId);
    const candidates = candidatesFor(element, read, parameterize);
    if (candidates.length === 0) {
      return fail('untargetable_element', `no locator candidate for ${element.node.role} ${JSON.stringify(element.node.name)}`, step.stepId);
    }
    const spec: TargetSpec = element.node.frame === null ? { candidates } : { frame: element.node.frame, candidates };
    const key = JSON.stringify(spec);
    const existing = bySpec.get(key);
    if (existing !== undefined) return existing;
    const name = unique(
      `${camel(words(element.node.frame ?? 'page'))}.${camel(nameWords(element, spec))}`,
      new Set([...Object.keys(targets), ...reserved]),
      '',
    );
    targets[name] = { ...spec, notes: targetNotes(spec, { read, accessibleName: element.node.name !== '' }) };
    bySpec.set(key, name);
    return name;
  }

  return { targets, locate };
}

type Registry = ReturnType<typeof targetRegistry>;

// A step before it gets its id; `idWords` name it.
type StepDraft = { readonly idWords: readonly string[]; readonly action: StepAction; readonly risk: Risk; readonly checkpoint: Predicate };

function leafWords(target: string): string[] {
  return words(target.split('.').at(-1) ?? target);
}

function revealedCheckpoint(step: TraceStep, parameterize: Parameterize): Predicate {
  const node = revealedText(step.observation, step.observationAfter);
  if (node === undefined) return fail('no_checkpoint', 'the action revealed no text to check for', step.stepId);
  const text = parameterize(node.name.trim());
  return node.frame === null ? { kind: 'text_visible', text } : { kind: 'text_visible', text, frame: node.frame };
}

// A handoff becomes a step only when the human did one thing automation can repeat: a single
// click on an element of the screen they were handed, with any confirmation dialog it opened
// accepted. The step is risky, so replay hands it (and its dialog) to a human again; what it
// clicks is only located, never performed, by automation.
function humanStep(stepId: string, handoff: readonly HumanTraceStep[], registry: Registry, parameterize: Parameterize): StepDraft {
  const clicks = handoff.filter((step) => step.action.kind === 'click');
  const others = handoff
    .filter(({ action }) => action.kind === 'input' || (action.kind === 'dialog' && action.decision !== 'accept'))
    .map(({ action }) => (action.kind === 'dialog' ? `a dialog ${action.decision}` : action.kind));
  const [click, ...moreClicks] = clicks;
  if (click === undefined || moreClicks.length > 0 || others.length > 0) {
    const did = [`${String(clicks.length)} click(s)`, ...others].join(', ');
    return fail('unsupported_human_steps', `the human did ${did} during the handoff; only a single click can become a step`, stepId);
  }
  const target = registry.locate(click, false);
  return { idWords: ['click', ...leafWords(target)], action: { kind: 'click', target }, risk: 'risky', checkpoint: revealedCheckpoint(click, parameterize) };
}

function agentStep(step: AgentTraceStep, registry: Registry, parameterize: Parameterize): StepDraft {
  const { decision } = step;
  const verb = decision.action.kind;
  if (decision.kind === 'read') {
    const { output } = decision;
    const target = registry.locate(step, true);
    return { idWords: [verb, ...words(output)], action: { kind: 'read', target, output }, risk: 'safe', checkpoint: { kind: 'target_visible', target } };
  }
  const performed = decision.action;
  switch (performed.kind) {
    case 'click':
    case 'press': {
      const target = registry.locate(step, false);
      const action: StepAction = performed.kind === 'click' ? { kind: 'click', target } : { kind: 'press', target, key: performed.key };
      return { idWords: [verb, ...leafWords(target)], action, risk: 'safe', checkpoint: revealedCheckpoint(step, parameterize) };
    }
    case 'fill':
    case 'select': {
      const target = registry.locate(step, false);
      const value = parameterize(performed.kind === 'fill' ? performed.value : performed.option);
      return {
        idWords: [verb, ...leafWords(target)],
        action: { kind: performed.kind, target, value },
        risk: 'safe',
        checkpoint: { kind: 'value_equals', target, value },
      };
    }
    case 'navigate': {
      const path = pathOf(performed.url);
      return { idWords: [verb, ...words(path)], action: { kind: 'navigate', path }, risk: 'safe', checkpoint: revealedCheckpoint(step, parameterize) };
    }
    default: {
      const unhandled: never = performed;
      return unhandled;
    }
  }
}

// The application rejecting what the model did (a declared business outcome newly shown, e.g.
// a validation error on submit) makes the step a detour, not part of the procedure.
function rejectionDetector(outcomes: readonly Outcome[]): (step: AgentTraceStep) => boolean {
  const rejections = outcomes.filter((outcome) => outcome.kind === 'business' && predicateTarget(outcome.when) === undefined);
  const shows = (observation: Observation, detector: Predicate) => evaluatePredicate(detector, { observation, targets: {} }).holds;
  return (step) => rejections.some(({ when }) => shows(step.observationAfter, when) && !shows(step.observation, when));
}

// The ordered steps: agent actions that made progress and were not rejected, each output read
// once, and one step per human handoff.
function procedureOf(
  trace: readonly TraceStep[],
  registry: Registry,
  parameterize: Parameterize,
  rejected: (step: AgentTraceStep) => boolean,
): { steps: Step[]; produced: ReadonlySet<string> } {
  const steps: Step[] = [];
  const produced = new Set<string>();
  const handoffs = new Set<string>();
  const add = ({ idWords, ...step }: StepDraft) => {
    steps.push({ id: unique(kebab(idWords), new Set(steps.map((existing) => existing.id)), '-'), ...step });
  };

  for (const step of trace) {
    if (step.actor === 'human') {
      if (handoffs.has(step.interventionId)) continue;
      handoffs.add(step.interventionId);
      const handoff = trace.filter((other): other is HumanTraceStep => other.actor === 'human' && other.interventionId === step.interventionId);
      add(humanStep(step.stepId, handoff, registry, parameterize));
      continue;
    }
    if (!step.progressed || rejected(step)) continue;
    if (step.decision.kind === 'read') {
      if (produced.has(step.decision.output)) continue;
      produced.add(step.decision.output);
    }
    add(agentStep(step, registry, parameterize));
  }
  return { steps, produced };
}

// Every declared output is read and every input drives some target or step.
function checkContract(request: CapabilityRequest, targets: Record<string, TargetSpec>, steps: readonly Step[], produced: ReadonlySet<string>): void {
  if (steps.length === 0) fail('no_steps', 'the trace has no step that made progress');
  for (const output of Object.keys(request.outputs)) {
    if (!produced.has(output)) fail('output_not_read', `output ${output} was never read`);
  }
  const used = JSON.stringify({ targets, steps });
  for (const [input, { example }] of Object.entries(request.inputs)) {
    if (!used.includes(`{{inputs.${input}}}`)) fail('input_not_used', `input ${input} (example ${JSON.stringify(example)}) appears in no step`);
  }
}

// The catalog declares every recovery target; one it did not would fail CapabilitySchema.
function recoveryTargetsOf(catalog: OutcomeCatalog, names: ReadonlySet<string>): Record<string, TargetSpec> {
  return Object.fromEntries(
    [...names].flatMap((name) => {
      const spec = catalog.targets[name];
      return spec === undefined ? [] : [[name, spec]];
    }),
  );
}

function build(trace: readonly TraceStep[], request: CapabilityRequest, catalog: OutcomeCatalog, provenance: Provenance): unknown {
  const parameterize = parameterizer(request);
  const outcomes: Outcome[] = request.outcomes.flatMap((id) => catalog.outcomes.filter((outcome) => outcome.id === id));
  const recoveryNames = new Set(outcomes.flatMap(outcomeTargets));
  const registry = targetRegistry(parameterize, recoveryNames);
  const { steps, produced } = procedureOf(trace, registry, parameterize, rejectionDetector(outcomes));
  checkContract(request, registry.targets, steps, produced);
  return {
    // A reviewer approves it before replay resolves to it by default (ADR-007).
    status: 'draft',
    capability: request.capability,
    preconditions: [{ kind: 'authenticated_session' }],
    ...contractOf(request),
    targets: { ...registry.targets, ...recoveryTargetsOf(catalog, recoveryNames) },
    steps,
    outcomes,
    provenance,
  };
}

// Turns a successful discovery trace into a capability artifact (RFC-003). Pure: the same
// trace always yields the same artifact.
export function synthesizeArtifact(
  trace: readonly TraceStep[],
  request: CapabilityRequest,
  catalog: OutcomeCatalog,
  provenance: Provenance,
): Synthesis {
  let draft: unknown;
  try {
    draft = build(trace, request, catalog, provenance);
  } catch (error) {
    if (error instanceof Failure) return { ok: false, error: error.error };
    throw error;
  }
  const parsed = CapabilitySchema.safeParse(draft);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`).join('; ');
    return { ok: false, error: { code: 'invalid_artifact', message: issues } };
  }
  return { ok: true, capability: parsed.data };
}
