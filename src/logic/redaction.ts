import type { Capability, Sensitivity } from '../models/capability';
import type { Observation } from '../models/observation';

export const SECRET_MASK = '[REDACTED:secret]';

export type SensitiveValue = {
  readonly value: string;
  readonly sensitivity: Exclude<Sensitivity, 'none'>;
};

// RFC-006: secrets are the environment's credentials; sensitive values are declared inputs and outputs.
export type RedactionRules = {
  readonly secrets: readonly string[];
  readonly sensitive: readonly SensitiveValue[];
};

const ACCOUNT_NUMBER = /\b\d{8,17}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const SECRET_KEY = /password|token|cookie|secret/i;
// Shorter values (e.g. "1") would mask unrelated text everywhere.
const MIN_SENSITIVE_LENGTH = 4;

function replaceLiteral(text: string, literal: string, mask: string): string {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escaped, 'gi'), () => mask);
}

export function redactText(text: string, rules: RedactionRules): string {
  let redacted = rules.secrets.filter((secret) => secret !== '').reduce((current, secret) => replaceLiteral(current, secret, SECRET_MASK), text);
  redacted = redacted.replace(ACCOUNT_NUMBER, (digits) => `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`);
  redacted = redacted.replace(SSN, '***-**-****');
  const sensitive = rules.sensitive.filter(({ value }) => value.length >= MIN_SENSITIVE_LENGTH).toSorted((a, b) => b.value.length - a.value.length);
  return sensitive.reduce((current, { value, sensitivity }) => replaceLiteral(current, value, `[REDACTED:${sensitivity}]`), redacted);
}

// A redacted copy of value: every string goes through redactText, and fields named like
// credentials are masked whole.
export function redactDeep<T>(value: T, rules: RedactionRules): T {
  return deep(value, rules) as T;
}

function deep(value: unknown, rules: RedactionRules): unknown {
  if (typeof value === 'string') return redactText(value, rules);
  if (Array.isArray(value)) return value.map((item) => deep(item, rules));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? SECRET_MASK : deep(item, rules)]));
  }
  return value;
}

// The observation as the model and the discovery trace may see it. A typed value also
// shows up in its parent's accessible name ("Member ID: 10001 Search"), so names are redacted too.
export function redactObservation(observation: Observation, rules: RedactionRules): Observation {
  const text = (value: string) => redactText(value, rules);
  return {
    ...observation,
    url: text(observation.url),
    frames: observation.frames.map((frame) => ({ ...frame, url: text(frame.url) })),
    nodes: observation.nodes.map((node) => ({
      ...node,
      name: text(node.name),
      ...(node.label === undefined ? {} : { label: text(node.label) }),
      ...(node.value === undefined ? {} : { value: text(node.value) }),
      ...(node.attributes === undefined ? {} : { attributes: redactDeep(node.attributes, rules) }),
    })),
    dialog: observation.dialog === null ? null : { ...observation.dialog, message: text(observation.dialog.message) },
  };
}

// Values of the declared inputs and outputs whose sensitivity is not `none` (RFC-002).
export function sensitiveValuesOf(
  capability: Capability,
  inputs: Readonly<Record<string, string>>,
  outputs: Readonly<Record<string, string>>,
): SensitiveValue[] {
  const pick = (specs: Record<string, { sensitivity: Sensitivity }>, values: Readonly<Record<string, string>>): SensitiveValue[] =>
    Object.entries(values).flatMap(([name, value]) => {
      const sensitivity = Object.hasOwn(specs, name) ? specs[name].sensitivity : 'none';
      return sensitivity === 'none' ? [] : [{ value, sensitivity }];
    });
  return [...pick(capability.inputs, inputs), ...pick(capability.outputs, outputs)];
}