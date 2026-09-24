# Safety, Guardrails & Regulated Data Handling (v1)

---

| Field | Value |
|---|---|
| **RFC** | RFC-006 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Defines the allowlist, action risk classification, and redaction model that bound what the system may do and what it may store. |

---

## Allowlist

`policy.json`, loaded at startup and enforced at the action gateway (ADR-011):

```json
{
  "allowedOrigins": ["http://localhost:8080"],
  "allowedRoutes": ["/", "/welcome", "/member/"],
  "allowedActions": ["click", "fill", "select", "navigate", "read"],
  "risky": {
    "routes": ["/member/danger/"],
    "controlText": ["Close Account", "Post Adjustment", "Confirm"]
  }
}
```

- Actions outside the allowlist are **denied**, not logged and executed
- Navigation to a disallowed origin or route is denied before the driver is called

## Risk classes

| Class | Examples | Policy |
|---|---|---|
| Safe / reversible | Navigate, fill a form field, read a value, search | Allowed |
| Risky / irreversible | Close account, post adjustment, final confirm of a write | Blocked for automation; human handoff only (RFC-005) |

The artifact records each step's `risk`; replay honors it even if policy changes.

## Redaction

- **Secrets** (credentials, tokens, cookies) never enter the system's data: the
  session provider holds them in memory only (ADR-013)
- **Sensitive values** are redacted by field `sensitivity` (RFC-002) and by
  patterns (account numbers, SSN-like strings) before:
  - observations are sent to the model
  - events and snapshots are written to evidence (ADR-014)
- Redaction is pure Logic, applied inside the reasoner client and the evidence
  recorder — the two places data leaves the process

## Limits

- Screenshots are not masked in v1; acceptable only because the target uses
  synthetic data
- Risk classification by route and control text is per-app configuration and can
  be wrong; it fails closed when in doubt
- The model provider receives redacted observations; a production deployment would
  also need a data-processing agreement or a self-hosted model

## Related

- ADR-011 — Guardrail Enforcement at a Single Action Gateway
- ADR-013 — Authentication as Environment Precondition
- ADR-014 — Per-Run Evidence Bundle Layout
- RFC-005 — Human-in-the-Loop Escalation & Session Handoff
