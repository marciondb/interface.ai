import { VERBS, type Verb } from '../models/action';
import type { Policy } from '../models/policy';
import { PolicyFileInSchema } from '../wire/in/policy-file';

export type PolicyFileResult = { ok: true; policy: Policy } | { ok: false; issues: string[] };

const ROUTE = /^\/[^*]*\*?$/;

function isVerb(value: string): value is Verb {
  return (VERBS as readonly string[]).includes(value);
}

function isOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

export function fromPolicyFile(raw: unknown): PolicyFileResult {
  const parsed = PolicyFileInSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`),
    };
  }
  const { allowedOrigins, allowedRoutes, allowedActions, risky } = parsed.data;
  const badRoutes = (field: string, routes: string[]) =>
    routes.filter((route) => !ROUTE.test(route)).map((route) => `${field}: ${JSON.stringify(route)} must start with / and may only end with *`);
  const issues = [
    ...allowedOrigins.filter((origin) => !isOrigin(origin)).map((origin) => `allowedOrigins: ${JSON.stringify(origin)} is not an origin`),
    ...badRoutes('allowedRoutes', allowedRoutes),
    ...allowedActions.filter((action) => !isVerb(action)).map((action) => `allowedActions: ${JSON.stringify(action)} is not a verb`),
    ...badRoutes('risky.routes', risky.routes),
    ...risky.controlText.filter((text) => text.trim() === '').map(() => 'risky.controlText: entries must not be blank'),
  ];
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, policy: { allowedOrigins, allowedRoutes, allowedActions: allowedActions.filter(isVerb), risky } };
}
