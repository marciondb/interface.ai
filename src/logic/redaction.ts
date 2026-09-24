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
const CREDENTIAL_KEY = /password|token|cookie|secret|authorization|api[-_]?key|session/i;
// Too short to match inside other words ("shipping", "footprint"): only as a whole word of the key.
const CREDENTIAL_WORDS = new Set(['pin', 'otp']);
const KEY_WORD_BREAK = /[^a-zA-Z0-9]+|(?<=[a-z0-9])(?=[A-Z])/;
const MASK_TOKEN = /\[REDACTED:[a-z]+\]/g;
// Shorter values (e.g. "1") would mask unrelated text everywhere.
const MIN_SENSITIVE_LENGTH = 4;

type Mask = { readonly literal: string; readonly mask: string };

function isCredentialKey(key: string): boolean {
  return CREDENTIAL_KEY.test(key) || key.split(KEY_WORD_BREAK).some((word) => CREDENTIAL_WORDS.has(word.toLowerCase()));
}

function applyMasks(text: string, masks: readonly Mask[]): string {
  return masks.reduce((current, { literal, mask }) => {
    const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return current.replace(new RegExp(escaped, 'gi'), () => mask);
  }, text);
}

function longestFirst(masks: readonly Mask[]): Mask[] {
  return masks.toSorted((a, b) => b.literal.length - a.literal.length);
}

// A secret also travels URL-encoded (query strings, form bodies) and JSON-escaped.
function secretForms(secret: string): string[] {
  const encoded = encodeURIComponent(secret);
  return [...new Set([secret, encoded, encoded.replaceAll('%20', '+'), JSON.stringify(secret).slice(1, -1)])];
}

function patterned(text: string, secrets: readonly Mask[], sensitive: readonly Mask[]): string {
  let redacted = applyMasks(text, secrets);
  redacted = redacted.replace(ACCOUNT_NUMBER, (digits) => `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`);
  redacted = redacted.replace(SSN, '***-**-****');
  return applyMasks(redacted, sensitive);
}

function redactor(rules: RedactionRules): (text: string) => string {
  const secrets = longestFirst(rules.secrets.filter((secret) => secret !== '').flatMap((secret) => secretForms(secret).map((literal) => ({ literal, mask: SECRET_MASK }))));
  const sensitive = longestFirst(
    rules.sensitive.filter(({ value }) => value.length >= MIN_SENSITIVE_LENGTH).map(({ value, sensitivity }) => ({ literal: value, mask: `[REDACTED:${sensitivity}]` })),
  );
  // A value can reach the text already partly masked: an account number "10001MMRAIN025000" written
  // as "[REDACTED:internal]MMRAIN025000" while only the member id was known. That form is masked too.
  const partial = longestFirst(
    sensitive.flatMap(({ literal, mask }) => {
      const form = patterned(literal, secrets, sensitive.filter((other) => other.literal !== literal));
      return form !== literal && form.replace(MASK_TOKEN, '').length >= MIN_SENSITIVE_LENGTH ? [{ literal: form, mask }] : [];
    }),
  );
  return (text) => applyMasks(patterned(text, secrets, sensitive), partial);
}

export function redactText(text: string, rules: RedactionRules): string {
  return redactor(rules)(text);
}

// A redacted copy of value: every string goes through redactText, and fields named like
// credentials are masked whole.
export function redactDeep<T>(value: T, rules: RedactionRules): T {
  return deep(value, redactor(rules)) as T;
}

function deep(value: unknown, text: (text: string) => string): unknown {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) return value.map((item) => deep(item, text));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, isCredentialKey(key) ? SECRET_MASK : deep(item, text)]));
  }
  return value;
}

// The observation as the model and the discovery trace may see it. A typed value also
// shows up in its parent's accessible name ("Member ID: 10001 Search"), so names are redacted too.
export function redactObservation(observation: Observation, rules: RedactionRules): Observation {
  const text = redactor(rules);
  return {
    ...observation,
    url: text(observation.url),
    frames: observation.frames.map((frame) => ({ ...frame, url: text(frame.url) })),
    nodes: observation.nodes.map((node) => ({
      ...node,
      name: text(node.name),
      ...(node.label === undefined ? {} : { label: text(node.label) }),
      ...(node.value === undefined ? {} : { value: text(node.value) }),
      ...(node.attributes === undefined ? {} : { attributes: deep(node.attributes, text) as Record<string, string> }),
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
