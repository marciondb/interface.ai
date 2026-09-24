export const SECRET_MASK = '[REDACTED:secret]';

// Replaces every occurrence of each secret in every string of value (RFC-006: the target password).
export function redactSecrets<T>(value: T, secrets: readonly string[]): T {
  const active = secrets.filter((secret) => secret !== '');
  if (active.length === 0) return value;
  return mask(value, active) as T;
}

function mask(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return secrets.reduce((text, secret) => text.split(secret).join(SECRET_MASK), value);
  if (Array.isArray(value)) return value.map((item) => mask(item, secrets));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mask(item, secrets)]));
  }
  return value;
}
