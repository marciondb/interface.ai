import type { Policy, PolicyDecision, PolicyRequest } from '../models/policy';

function routeMatches(route: string, path: string): boolean {
  return route.endsWith('*') ? path.startsWith(route.slice(0, -1)) : path === route;
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Why url is outside the allowlist, or undefined when it is inside.
export function urlViolation(url: string, policy: Policy): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${url} is not a valid URL`;
  }
  if (!policy.allowedOrigins.includes(parsed.origin)) return `origin ${parsed.origin} is not allowed`;
  if (!policy.allowedRoutes.some((route) => routeMatches(route, parsed.pathname))) {
    return `route ${parsed.pathname} is not allowed`;
  }
  return undefined;
}

// Deny if the verb, the page, the element's frame or where the action leads is outside the allowlist;
// otherwise require a human if the page, the destination or the control is risky (RFC-006).
export function evaluatePolicy(request: PolicyRequest, policy: Policy): PolicyDecision {
  const { action, element, currentUrl } = request;
  if (!policy.allowedActions.includes(action.verb)) return { decision: 'deny', reason: `action ${action.verb} is not allowed` };

  const destination = action.verb === 'navigate' ? (action.argument ?? undefined) : element?.destination;
  const checks: [string, string | undefined][] = [
    ['current page', currentUrl],
    ['element frame', element?.frameUrl],
    ['destination', destination],
  ];
  for (const [what, url] of checks) {
    if (url === undefined) continue;
    const violation = urlViolation(url, policy);
    if (violation !== undefined) return { decision: 'deny', reason: `${what}: ${violation}` };
  }

  // Reading a value never changes the page, so it is safe everywhere.
  if (action.verb === 'read') return { decision: 'allow' };
  const riskyChecks: [string, string | undefined][] = [
    ['current page', currentUrl],
    ['destination', destination],
  ];
  for (const [what, url] of riskyChecks) {
    if (url === undefined) continue;
    const path = new URL(url).pathname;
    if (policy.risky.routes.some((route) => routeMatches(route, path))) {
      return { decision: 'requires_human', reason: `${what}: route ${path} is risky` };
    }
  }
  if (element !== undefined && policy.risky.controlText.some((text) => normalize(text) === normalize(element.name))) {
    return { decision: 'requires_human', reason: `control "${element.name.trim()}" is risky` };
  }
  return { decision: 'allow' };
}
