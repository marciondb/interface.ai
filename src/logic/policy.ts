import type { Policy, PolicyDecision, PolicyRequest } from '../models/policy';

function routeMatches(route: string, path: string): boolean {
  return route.endsWith('*') ? path.startsWith(route.slice(0, -1)) : path === route;
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

// Deny if the verb, the page, the element's frame or where the action leads is outside the allowlist (RFC-006).
export function evaluatePolicy(request: PolicyRequest, policy: Policy): PolicyDecision {
  const { action, element, currentUrl } = request;
  if (!policy.allowedActions.includes(action.verb)) return { decision: 'deny', reason: `action ${action.verb} is not allowed` };

  const checks: [string, string | undefined][] = [
    ['current page', currentUrl],
    ['element frame', element?.frameUrl],
    ['destination', action.verb === 'navigate' ? (action.argument ?? undefined) : element?.destination],
  ];
  for (const [what, url] of checks) {
    if (url === undefined) continue;
    const violation = urlViolation(url, policy);
    if (violation !== undefined) return { decision: 'deny', reason: `${what}: ${violation}` };
  }
  return { decision: 'allow' };
}
