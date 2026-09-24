import type { Landing, Policy, PolicyDecision, PolicyRequest } from '../models/policy';

// The path with each segment percent-decoded, `;params` dropped and empty segments removed;
// undefined when a segment decodes to a separator or a dot segment (fail closed).
function canonicalPath(pathname: string): string | undefined {
  const segments: string[] = [];
  for (const raw of pathname.split('/')) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw.replace(/;.*/s, ''));
    } catch {
      return undefined;
    }
    if (segment.includes('/') || segment.includes('\\') || segment === '.' || segment === '..') return undefined;
    if (segment !== '') segments.push(segment);
  }
  const trailing = segments.length > 0 && pathname.endsWith('/') ? '/' : '';
  return `/${segments.join('/')}${trailing}`;
}

// `/x/*` matches `/x` and everything under `/x/`.
function routeMatches(route: string, path: string): boolean {
  if (!route.endsWith('*')) return path === route;
  const prefix = route.slice(0, -1);
  return path.startsWith(prefix) || (prefix.endsWith('/') && path === prefix.slice(0, -1));
}

// Unicode-compatible form, without invisible format characters, spaces collapsed, lower case.
function normalize(text: string): string {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Whether phrase appears in text as whole words.
function mentions(text: string, phrase: string): boolean {
  const escaped = normalize(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped !== '' && new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(normalize(text));
}

// Frames with nothing loaded in them yet.
function isBlank(url: string): boolean {
  return url === 'about:blank' || url === 'about:srcdoc';
}

// Why url is outside the allowlist, or undefined when it is inside.
export function urlViolation(url: string, policy: Policy): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${url} is not a valid URL`;
  }
  if (parsed.username !== '' || parsed.password !== '') return 'credentials in the URL are not allowed';
  if (!policy.allowedOrigins.includes(parsed.origin)) return `origin ${parsed.origin} is not allowed`;
  const path = canonicalPath(parsed.pathname);
  if (path === undefined) return `route ${parsed.pathname} is not a plain path`;
  if (!policy.allowedRoutes.some((route) => routeMatches(route, path))) {
    return `route ${parsed.pathname} is not allowed`;
  }
  return undefined;
}

// The canonical path of url when it is a risky route (compared case-insensitively). url must
// already be inside the allowlist.
function riskyRoute(url: string, policy: Policy): string | undefined {
  const path = canonicalPath(new URL(url).pathname)?.toLowerCase();
  if (path === undefined) return undefined;
  return policy.risky.routes.some((route) => routeMatches(route.toLowerCase(), path)) ? path : undefined;
}

// Deny if the verb, the page, the element's frame or where the action leads is outside the allowlist;
// otherwise require a human if the page, the element's frame, the destination or the control is risky (RFC-006).
export function evaluatePolicy(request: PolicyRequest, policy: Policy): PolicyDecision {
  const { action, element, currentUrl } = request;
  if (!policy.allowedActions.includes(action.kind)) return { decision: 'deny', reason: `action ${action.kind} is not allowed` };

  const destination = action.kind === 'navigate' ? action.url : element?.destination;
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
  if (action.kind === 'read') return { decision: 'allow' };
  // The fixture keeps the top page at `/` and shows each screen in a frame: the element's frame is its page.
  for (const [what, url] of checks) {
    if (url === undefined) continue;
    const path = riskyRoute(url, policy);
    if (path !== undefined) return { decision: 'requires_human', reason: `${what}: route ${path} is risky` };
  }
  if (element !== undefined) {
    const texts = [element.name, ...(element.texts ?? [])];
    for (const text of texts) {
      if (policy.risky.controlText.some((risky) => mentions(text, risky))) {
        return { decision: 'requires_human', reason: `control "${text.trim()}" is risky` };
      }
    }
  }
  return { decision: 'allow' };
}

// Judged after the driver acted (ADR-011): every URL the action loaded and every frame must be
// inside the allowlist, and none the action moved a frame to may be a risky route. `before` are
// the frame URLs before the action; a frame still at one of them was not moved by it.
export function evaluateLanding(
  landed: { readonly loaded: readonly string[]; readonly frames: readonly string[]; readonly before: readonly string[] },
  policy: Policy,
): Landing | undefined {
  const { loaded, frames, before } = landed;
  for (const url of [...loaded, ...frames]) {
    if (!isBlank(url) && urlViolation(url, policy) !== undefined) return { reason: 'landed_outside_allowlist', landedAt: url };
  }
  for (const url of [...loaded, ...frames.filter((frame) => !before.includes(frame))]) {
    if (!isBlank(url) && riskyRoute(url, policy) !== undefined) return { reason: 'landed_on_risky_route', landedAt: url };
  }
  return undefined;
}

export function describeLanding(landing: Landing): string {
  return `${landing.reason} at ${landing.landedAt}`;
}
