import type { Candidate, Capability, Outcome, Predicate, Provenance, Step, StepAction, TargetSpec } from '../models/capability';
import { CapabilitySchema, PLACEHOLDER, predicateTarget } from '../models/capability';
import type { CapabilityRequest } from '../models/capability-request';
import type { AgentTraceStep, HumanTraceStep, TraceStep } from '../models/discovery';
import { outcomeTargets, type OutcomeCatalog } from '../models/outcome-catalog';
import type { Observation, ObservationNode } from '../models/observation';
import { evaluatePredicate } from './checkpoint';

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

function build(trace: readonly TraceStep[], request: CapabilityRequest, catalog: OutcomeCatalog, provenance: Provenance): unknown {
  const parameterize = parameterizer(request);
  const outcomes: Outcome[] = request.outcomes.flatMap((id) => catalog.outcomes.filter((outcome) => outcome.id === id));
  const recoveryTargets = new Set(outcomes.flatMap(outcomeTargets));
  const targets: Record<string, TargetSpec> = {};
  const targetBySpec = new Map<string, string>();
  const steps: Step[] = [];
  const produced = new Set<string>();

  function targetFor(step: TraceStep, read: boolean): string {
    const { element } = step;
    const verb = step.actor === 'human' ? `the human's ${step.action.kind}` : step.decision.action.kind;
    if (element === undefined) return fail('untargetable_element', `${verb} has no element to locate`, step.stepId);
    const candidates = candidatesFor(element, read, parameterize);
    if (candidates.length === 0) {
      return fail('untargetable_element', `no locator candidate for ${element.node.role} ${JSON.stringify(element.node.name)}`, step.stepId);
    }
    const spec: TargetSpec = element.node.frame === null ? { candidates } : { frame: element.node.frame, candidates };
    const key = JSON.stringify(spec);
    const existing = targetBySpec.get(key);
    if (existing !== undefined) return existing;
    const name = unique(
      `${camel(words(element.node.frame ?? 'page'))}.${camel(nameWords(element, spec))}`,
      new Set([...Object.keys(targets), ...recoveryTargets]),
      '',
    );
    targets[name] = spec;
    targetBySpec.set(key, name);
    return name;
  }

  function revealed(step: TraceStep): Predicate {
    const node = revealedText(step.observation, step.observationAfter);
    if (node === undefined) return fail('no_checkpoint', 'the action revealed no text to check for', step.stepId);
    const text = parameterize(node.name.trim());
    return node.frame === null ? { kind: 'text_visible', text } : { kind: 'text_visible', text, frame: node.frame };
  }

  // A handoff becomes a step only when the human did one thing automation can repeat: a single
  // click on an element of the screen they were handed, with any confirmation dialog it opened
  // accepted. The step is risky, so replay hands it (and its dialog) to a human again; what it
  // clicks is only located, never performed, by automation.
  function humanStep(stepId: string, handoff: readonly HumanTraceStep[]): void {
    const clicks = handoff.filter((step) => step.action.kind === 'click');
    const others = handoff
      .filter(({ action }) => action.kind === 'input' || (action.kind === 'dialog' && action.decision !== 'accept'))
      .map(({ action }) => (action.kind === 'dialog' ? `a dialog ${action.decision}` : action.kind));
    const [click, ...moreClicks] = clicks;
    if (click === undefined || moreClicks.length > 0 || others.length > 0) {
      const did = [`${String(clicks.length)} click(s)`, ...others].join(', ');
      return fail('unsupported_human_steps', `the human did ${did} during the handoff; only a single click can become a step`, stepId);
    }
    const target = targetFor(click, false);
    const id = unique(kebab(['click', ...words(target.split('.').at(-1) ?? target)]), new Set(steps.map((existing) => existing.id)), '-');
    steps.push({ id, action: { kind: 'click', target }, risk: 'risky', checkpoint: revealed(click) });
  }

  // The application rejecting what the model did (a declared business outcome newly shown, e.g.
  // a validation error on submit) makes the step a detour, not part of the procedure.
  const rejections = outcomes.filter((outcome) => outcome.kind === 'business' && predicateTarget(outcome.when) === undefined);
  function rejected(step: AgentTraceStep): boolean {
    const shows = (observation: Observation, detector: Predicate) => evaluatePredicate(detector, { observation, targets: {} }).holds;
    return rejections.some(({ when }) => shows(step.observationAfter, when) && !shows(step.observation, when));
  }

  const handoffs = new Set<string>();
  for (const step of trace) {
    if (step.actor === 'human') {
      if (handoffs.has(step.interventionId)) continue;
      handoffs.add(step.interventionId);
      humanStep(step.stepId, trace.filter((other): other is HumanTraceStep => other.actor === 'human' && other.interventionId === step.interventionId));
      continue;
    }
    if (!step.progressed || rejected(step)) continue;
    const { decision } = step;
    let action: StepAction;
    let checkpoint: Predicate;
    let label: string[];
    if (decision.kind === 'read') {
      const { output } = decision;
      if (produced.has(output)) continue;
      produced.add(output);
      const target = targetFor(step, true);
      action = { kind: 'read', target, output };
      checkpoint = { kind: 'target_visible', target };
      label = words(output);
    } else {
      const performed = decision.action;
      switch (performed.kind) {
        case 'click':
        case 'press': {
          const target = targetFor(step, false);
          action = performed.kind === 'click' ? { kind: 'click', target } : { kind: 'press', target, key: performed.key };
          checkpoint = revealed(step);
          label = words(target.split('.').at(-1) ?? target);
          break;
        }
        case 'fill':
        case 'select': {
          const target = targetFor(step, false);
          const value = parameterize(performed.kind === 'fill' ? performed.value : performed.option);
          action = { kind: performed.kind, target, value };
          checkpoint = { kind: 'value_equals', target, value };
          label = words(target.split('.').at(-1) ?? target);
          break;
        }
        case 'navigate':
          action = { kind: 'navigate', path: pathOf(performed.url) };
          checkpoint = revealed(step);
          label = words(action.path);
          break;
        default: {
          const unhandled: never = performed;
          return unhandled;
        }
      }
    }
    const id = unique(kebab([decision.action.kind, ...label]), new Set(steps.map((existing) => existing.id)), '-');
    steps.push({ id, action, risk: 'safe', checkpoint });
  }

  if (steps.length === 0) fail('no_steps', 'the trace has no step that made progress');
  for (const output of Object.keys(request.outputs)) {
    if (!produced.has(output)) fail('output_not_read', `output ${output} was never read`);
  }
  const used = JSON.stringify({ targets, steps });
  // The catalog declares every recovery target; one it did not would fail CapabilitySchema below.
  for (const name of recoveryTargets) {
    const spec = catalog.targets[name];
    if (spec !== undefined) targets[name] = spec;
  }
  for (const [input, { example }] of Object.entries(request.inputs)) {
    if (!used.includes(`{{inputs.${input}}}`)) fail('input_not_used', `input ${input} (example ${JSON.stringify(example)}) appears in no step`);
  }

  const inputs = Object.fromEntries(
    Object.entries(request.inputs).map(([name, input]) => [name, Object.fromEntries(Object.entries(input).filter(([field]) => field !== 'example'))]),
  );
  return {
    capability: request.capability,
    preconditions: [{ kind: 'authenticated_session' }],
    inputs,
    outputs: request.outputs,
    targets,
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
