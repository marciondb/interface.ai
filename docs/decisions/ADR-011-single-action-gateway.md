# Guardrail Enforcement at a Single Action Gateway

| Field | Value |
|---|---|
| **ADR** | ADR-011 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Every action on both discovery and replay paths passes through one gateway that evaluates policy before the surface driver is called. Risky actions are blocked for automation and can only be performed by a human during handoff. |

---

## Context

Guardrails scattered across the agent loop, the replay engine, and the driver are
easy to bypass by accident. The policy also needs to be testable and configurable.

## Decision

- **One gateway** wraps the surface driver. Controllers never act through the raw
  driver; the escalation controller only gets a view of the live window that
  observes and captures human actions (ADR-012)
- **Policy is pure Logic**: `evaluatePolicy({ action, element, currentUrl }, policy) →
  allow | deny(reason) | requires_human(reason)`
- **Policy is a config file** (`policy.json`): allowed origins, allowed routes,
  allowed action types, and risky-action rules (by route and by control
  text, e.g. `Close Account`, `Post Adjustment`)

- **Precedence:** `deny` > `requires_human` > `allow`
- **Matching:** routes match exactly on the canonical path, and a trailing `*` is a
  prefix match (`/member/*` matches `/member` and everything under it); a URL
  carrying credentials is always denied; risky control text is matched as whole
  words in any label the control shows (RFC-006)
- **Landing check:** after the driver acts, the gateway checks where the page and
  its frames ended up; outside the allowlist or on a newly reached risky route, the
  outcome is `landed_outside_policy` with the landed URL. The gateway also installs a navigation
  guard on the driver that aborts off-allowlist navigations, and the browser session
  closes any popup

Risky-action policy: **block for automation, allow only through human handoff.**
In discovery, a `deny` before acting is returned to the model as feedback, while
`requires_human` triggers the human handoff; a `deny` after acting (landing) ends
the run. In replay, a step marked `risky` in the artifact escalates instead of
executing, even if the policy would allow it, unless the policy denies it
(deny wins). The gateway also rejects every automation action except `read` while
a human owns control (ADR-012).

## Consequences

**Positive**
- No code path reaches the surface without a policy decision
- Policy is exhaustively unit-testable
- Irreversible actions always have a human accountable for them

**Negative**
- Classifying risk by route and control text is app-specific configuration
- A too-strict policy stalls discovery; denials are logged to tune it

## Alternatives

- **Flag and continue** — rejected: logging an irreversible action after the fact
  does not undo it.
- **Ask for confirmation inline** — rejected: equivalent to handoff but without a
  control-transfer model or evidence of who approved.

## Related

- ADR-012 — Same-Session Control Transfer for Human Handoff
- ADR-015 — Local Reasoner with Schema-Constrained Output
- RFC-006 — Safety, Guardrails & Regulated Data Handling
