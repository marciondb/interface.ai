import type { Candidate, Capability, Outcome, Predicate, Provenance, Step, StepAction, TargetSpec } from '../models/capability';
import { CapabilitySchema, PLACEHOLDER } from '../models/capability';
import type { CapabilityRequest } from '../models/capability-request';
import type { TraceStep } from '../models/discovery';
import { outcomeTargets, type OutcomeCatalog } from '../models/outcome-catalog';
import type { Observation, ObservationNode } from '../models/observation';

export type SynthesisErrorCode = 'no_steps' | 'untargetable_element' | 'no_checkpoint' | 'output_not_read' | 'input_not_used' | 'invalid_artifact';

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
  const joined = parts.map((word, index) => (index === 0 ? word.toLowerCase() : `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`)).join('');
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
function candidatesFor(element: NonNullable<TraceStep['element']>, read: boolean, parameterize: (text: string) => string): Candidate[] {
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
    // A value read is data, so it never locates itself by its own text.
    const named = !read && node.name !== '' && !CONTEXT_ROLES.has(node.role);
    chain = [
      ...(named ? [{ strategy: 'role' as const, role: node.role, name: parameterize(node.name) }] : []),
      ...(descriptor.label === undefined ? [] : [{ strategy: 'label' as const, text: parameterize(descriptor.label) }]),
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

function nameWords(element: NonNullable<TraceStep['element']>, spec: TargetSpec): string[] {
  const first = spec.candidates[0];
  if (first.strategy === 'table_cell') return words(first.column);
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
    if (element === undefined) return fail('untargetable_element', `${step.decision.verb} has no element to locate`, step.stepId);
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

  for (const step of trace.filter((candidate) => candidate.progressed)) {
    const { decision } = step;
    const argument = decision.argument ?? '';
    let action: StepAction;
    let checkpoint: Predicate;
    let label: string[];
    switch (decision.verb) {
      case 'click':
      case 'press': {
        const target = targetFor(step, false);
        action = decision.verb === 'click' ? { kind: 'click', target } : { kind: 'press', target, key: argument };
        checkpoint = revealed(step);
        label = words(target.split('.').at(-1) ?? target);
        break;
      }
      case 'fill':
      case 'select': {
        const target = targetFor(step, false);
        const value = parameterize(argument);
        action = { kind: decision.verb, target, value };
        checkpoint = { kind: 'value_equals', target, value };
        label = words(target.split('.').at(-1) ?? target);
        break;
      }
      case 'navigate':
        action = { kind: 'navigate', path: pathOf(argument) };
        checkpoint = revealed(step);
        label = words(action.path);
        break;
      case 'read': {
        if (produced.has(argument)) continue;
        produced.add(argument);
        const target = targetFor(step, true);
        action = { kind: 'read', target, output: argument };
        checkpoint = { kind: 'target_visible', target };
        label = [argument];
        break;
      }
      case 'finish':
      case 'request_help':
        continue;
      default: {
        const unhandled: never = decision.verb;
        return unhandled;
      }
    }
    const id = unique(kebab([decision.verb, ...label]), new Set(steps.map((existing) => existing.id)), '-');
    steps.push({ id, action, risk: 'safe', checkpoint });
  }

  if (steps.length === 0) fail('no_steps', 'the trace has no step that made progress');
  for (const output of Object.keys(request.outputs)) {
    if (!produced.has(output)) fail('output_not_read', `output ${output} was never read`);
  }
  const used = JSON.stringify({ targets, steps });
  for (const name of recoveryTargets) targets[name] = catalog.targets[name];
  for (const input of Object.keys(request.inputs)) {
    if (!used.includes(`{{inputs.${input}}}`)) fail('input_not_used', `input ${input} (example ${JSON.stringify(request.inputs[input].example)}) appears in no step`);
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
