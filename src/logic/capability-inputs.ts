import { PLACEHOLDER, type Capability, type InputSpec } from '../models/capability';

export type InputErrorCode = 'missing' | 'unknown' | 'type' | 'pattern' | 'enum';

// Messages never echo the value: inputs may be sensitive.
export interface InputError {
  input: string;
  code: InputErrorCode;
  message: string;
}

export type InputValidation = { ok: true; values: Record<string, string> } | { ok: false; errors: InputError[] };

const NUMBER = /^-?[0-9]+(\.[0-9]+)?$/;

export function validateInputs(capability: Capability, raw: Record<string, string>): InputValidation {
  const errors: InputError[] = [];
  for (const name of Object.keys(raw)) {
    if (!Object.hasOwn(capability.inputs, name)) {
      errors.push({ input: name, code: 'unknown', message: `${name} is not an input of ${capability.capability.id}` });
    }
  }
  for (const [name, spec] of Object.entries(capability.inputs)) {
    const error = Object.hasOwn(raw, name) ? checkValue(spec, raw[name]) : { code: 'missing' as const, message: 'is required' };
    if (error !== undefined) errors.push({ input: name, code: error.code, message: `${name} ${error.message}` });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, values: { ...raw } };
}

function checkValue(spec: InputSpec, value: string): { code: InputErrorCode; message: string } | undefined {
  if (spec.type === 'number' && !NUMBER.test(value)) return { code: 'type', message: 'must be a number' };
  if (spec.pattern !== undefined && !new RegExp(spec.pattern).test(value)) {
    return { code: 'pattern', message: `must match ${spec.pattern}` };
  }
  if (spec.enum !== undefined && !spec.enum.includes(value)) {
    return { code: 'enum', message: `must be one of ${spec.enum.join(', ')}` };
  }
  return undefined;
}

// Replaces every {{inputs.<name>}} in targets, steps and outcomes. Expects values from validateInputs.
export function bindInputs(capability: Capability, values: Record<string, string>): Capability {
  const bind = <T>(section: T): T => bindStrings(section, values) as T;
  return {
    ...capability,
    targets: bind(capability.targets),
    steps: bind(capability.steps),
    outcomes: bind(capability.outcomes),
  };
}

function bindStrings(value: unknown, values: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER, (_, name: string) => {
      if (!Object.hasOwn(values, name)) throw new Error(`no value bound for input ${name}`);
      return values[name];
    });
  }
  if (Array.isArray(value)) return value.map((item) => bindStrings(item, values));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bindStrings(item, values)]));
  }
  return value;
}
