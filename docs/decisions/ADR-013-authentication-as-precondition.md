# Authentication as Environment Precondition

| Field | Value |
|---|---|
| **ADR** | ADR-013 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Signing in is not a step inside capability artifacts. Artifacts declare an authenticated-session precondition, and a session provider establishes it from environment credentials before the capability runs. |

---

## Context

The target requires a login. Recording it as steps would put credential handling
inside every artifact and tie each capability to one tenant's login flow.

## Decision

- Artifacts declare `preconditions: [{ "kind": "authenticated_session" }]`
- A **session provider** Diplomat establishes the session before discovery or
  replay, reading credentials from environment variables. It logs in over HTTP
  (posting the login form) and injects the session cookie into the browser
  context, so the password never appears in the browser, the accessibility
  snapshot, screenshots, or evidence
- Credentials never appear in artifacts, observations sent to the model, or evidence
- Session expiry during replay is a **recoverable condition**: re-authenticate
  once and restart the capability from its first step (a fresh login lands on the
  home screen, so re-running only the current step is not possible); a second
  expiry is a hard failure

## Consequences

**Positive**
- No secret can leak through an artifact
- Capabilities are reusable across tenants with different login methods (form, SSO)
- Login is written once per app, not once per capability

**Negative**
- The session provider is app-specific code, not a discovered artifact
- Discovery never sees the login screen, so it cannot learn it

## Alternatives

- **Login as recorded steps with a secret parameter** — rejected: credentials flow
  through the artifact and the model context.
- **Reuse a saved browser profile** — rejected: stale sessions and a secret at rest.

## Related

- RFC-001 — System Scope & Component Landscape
- RFC-004 — Deterministic Replay & Execution Result Contract
- RFC-006 — Safety, Guardrails & Regulated Data Handling
