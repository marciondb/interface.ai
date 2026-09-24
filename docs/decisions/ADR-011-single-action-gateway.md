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

- **One gateway** wraps the surface driver. Controllers never hold a reference to
  the raw driver
- **Policy is pure Logic**: `evaluate(action, target, currentUrl, policy) →
  allow | deny(reason) | requires_human(reason)`
- **Policy is a config file** (`policy.json`): allowed origins, allowed route
  prefixes, allowed action types, and risky-action rules (by route and by control
  text, e.g. `Close Account`, `Post Adjustment`)

Risky-action policy: **block for automation, allow only through human handoff.**
In discovery, a denial is returned to the model as an observation. In replay, a
step marked risky escalates instead of executing.

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

- ADR-015 — Local Reasoner with Schema-Constrained Output
- RFC-006 — Safety, Guardrails & Regulated Data Handling
