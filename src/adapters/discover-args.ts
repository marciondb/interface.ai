import type { z } from 'zod';
import { SemverSchema, SENSITIVITIES } from '../models/capability';
import { CapabilityRequestSchema, type CapabilityRequest } from '../models/capability-request';
import type { OutcomeCatalog } from '../models/outcome-catalog';
import { DiscoverArgsInSchema } from '../wire/in/discover-args';
import type { CapabilityRequestResult } from './capability-request';
import { DEFAULT_TARGET } from './replay-args';

export type ReasonerChoice = 'local' | 'hosted';

// The only catalogued app (discovery/catalogs/).
export const DEFAULT_PRODUCT = 'legacy-member-console';
const DEFAULT_VERSION = '1.0.0';
const DEFAULT_SENSITIVITY = 'internal';

// A field given as name=example[:sensitivity] (inputs) or name[:sensitivity] (outputs).
// The sensitivity is checked by the request schema.
export type GoalField = { readonly name: string; readonly example: string; readonly sensitivity: string };

// A capability request given on the command line instead of a file.
export type GoalArgs = {
  // Template with {{input}} placeholders.
  readonly goal: string;
  readonly capabilityId: string;
  readonly product: string;
  readonly inputs: readonly GoalField[];
  readonly outputs: readonly Omit<GoalField, 'example'>[];
  // Default: every outcome of the app's catalog.
  readonly outcomes?: readonly string[];
};

export type RequestSource = { readonly kind: 'file'; readonly path: string } | { readonly kind: 'goal'; readonly goal: GoalArgs };

export type DiscoverArgs = {
  readonly source: RequestSource;
  // Replaces the request's capability version.
  readonly version?: string;
  readonly reasoner: ReasonerChoice;
  readonly targetUrl: string;
  readonly headed: boolean;
};

export type DiscoverArgsResult = { ok: true; args: DiscoverArgs } | { ok: false; issues: string[] };

function targetUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// A trailing :word is the sensitivity only when it names one; `secret` is kept so the schema can refuse it.
function splitSensitivity(text: string): { rest: string; sensitivity: string } {
  const separator = text.lastIndexOf(':');
  const suffix = text.slice(separator + 1);
  if (separator >= 0 && ([...SENSITIVITIES, 'secret'] as readonly string[]).includes(suffix)) return { rest: text.slice(0, separator), sensitivity: suffix };
  return { rest: text, sensitivity: DEFAULT_SENSITIVITY };
}

// Values are never echoed: examples may be sensitive.
function goalFields(flag: string, pairs: readonly string[], withExample: boolean, issues: string[]): GoalField[] {
  const fields: GoalField[] = [];
  for (const pair of pairs) {
    const { rest, sensitivity } = splitSensitivity(pair);
    const separator = withExample ? rest.indexOf('=') : rest.length;
    const name = rest.slice(0, separator);
    if (separator <= 0) issues.push(withExample ? `${flag} must look like name=example[:sensitivity]` : `${flag} must look like name[:sensitivity]`);
    else if (fields.some((field) => field.name === name)) issues.push(`${flag} ${name} is given more than once`);
    else fields.push({ name, example: rest.slice(separator + 1), sensitivity });
  }
  return fields;
}

function goalArgs(args: z.infer<typeof DiscoverArgsInSchema>, issues: string[]): GoalArgs | undefined {
  const goal = args.goal ?? '';
  if (goal === '') issues.push('--goal must not be empty');
  if (args.capability === undefined || args.capability === '') issues.push('--capability <id> is required with --goal');
  if ((args.output ?? []).length === 0) issues.push('--output is required with --goal, at least once');
  const inputs = goalFields('--input', args.input ?? [], true, issues);
  const outputs = goalFields('--output', args.output ?? [], false, issues).map(({ name, sensitivity }) => ({ name, sensitivity }));
  if (args.capability === undefined) return undefined;
  return {
    goal,
    capabilityId: args.capability,
    product: DEFAULT_PRODUCT,
    inputs,
    outputs,
    ...(args.outcome === undefined ? {} : { outcomes: args.outcome }),
  };
}

export function toDiscoverArgs(raw: unknown): DiscoverArgsResult {
  const parsed = DiscoverArgsInSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((issue) => `--${issue.path.map(String).join('.')}: ${issue.message}`) };
  const args = parsed.data;
  const issues: string[] = [];

  let source: RequestSource | undefined;
  if (args.request !== undefined && args.goal !== undefined) issues.push('--request and --goal are exclusive: give one');
  else if (args.goal !== undefined) {
    const goal = goalArgs(args, issues);
    if (goal !== undefined) source = { kind: 'goal', goal };
  } else if (args.request === undefined || args.request === '') issues.push('--request <file> or --goal <text> is required');
  else {
    source = { kind: 'file', path: args.request };
    const goalOnly = (['capability', 'input', 'output', 'outcome'] as const).filter((flag) => args[flag] !== undefined);
    if (goalOnly.length > 0) issues.push(`${goalOnly.map((flag) => `--${flag}`).join(', ')} only apply with --goal`);
  }
  if (args.version !== undefined && !SemverSchema.safeParse(args.version).success) issues.push('--version must be semver MAJOR.MINOR.PATCH');
  const reasoner = args.reasoner ?? 'local';
  if (reasoner !== 'local' && reasoner !== 'hosted') issues.push('--reasoner must be local or hosted');
  const target = targetUrl(args.target ?? DEFAULT_TARGET);
  if (target === undefined) issues.push('--target must be an http(s) URL');

  if (issues.length > 0 || source === undefined || target === undefined || (reasoner !== 'local' && reasoner !== 'hosted')) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    args: { source, ...(args.version === undefined ? {} : { version: args.version }), reasoner, targetUrl: target, headed: args.headed ?? false },
  };
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `request ${issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.')}: ${issue.message}`);
}

// The request a --goal describes, validated like a request file; fields are strings described by their name.
export function toGoalRequest(goal: GoalArgs, catalog: OutcomeCatalog, version = DEFAULT_VERSION): CapabilityRequestResult {
  const parsed = CapabilityRequestSchema.safeParse({
    capability: { id: goal.capabilityId, version, description: goal.goal, app: { product: goal.product, surface: 'web' } },
    goal: goal.goal,
    inputs: Object.fromEntries(goal.inputs.map(({ name, example, sensitivity }) => [name, { type: 'string', description: name, sensitivity, example }])),
    outputs: Object.fromEntries(goal.outputs.map(({ name, sensitivity }) => [name, { type: 'string', description: name, sensitivity }])),
    outcomes: goal.outcomes ?? catalog.outcomes.map((outcome) => outcome.id),
  });
  return parsed.success ? { ok: true, request: parsed.data } : { ok: false, issues: formatIssues(parsed.error) };
}

export function withVersion(request: CapabilityRequest, version: string | undefined): CapabilityRequest {
  return version === undefined ? request : { ...request, capability: { ...request.capability, version } };
}
