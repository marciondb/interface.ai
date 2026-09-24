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
  "allowedRoutes": ["/", "/welcome", "/member/*"],
  "allowedActions": ["click", "fill", "select", "navigate", "read"],
  "risky": {
    "routes": ["/member/danger/*"],
    "controlText": ["Close Account", "Post Adjustment", "Confirm"]
  }
}
```

- Routes match exactly; a trailing `*` makes the entry a prefix match
- Risky control text is compared as a normalized exact match
- Precedence: deny > `requires_human` > allow
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
- **Sensitive values** are redacted before:
  - observations are sent to the model
  - events and snapshots are written to evidence (ADR-014)
- Patterns redacted:
  - the target password
  - account-number-like digit runs, keeping the last 4 digits
  - SSN-like strings
  - declared input and output values whose `sensitivity` (RFC-002) is not `none`
- Redaction is pure Logic, applied in two places: in discovery, the controller
  redacts each observation before calling the reasoner; the evidence recorder
  redacts before writing
- Outputs are masked in evidence but returned unmasked to the caller

## Data residency

The default reasoner is a local model (ADR-015): observations are redacted **and**
never leave the machine. Redaction is still applied on the local path, so switching
to the hosted adapter does not change what the model sees.

The hosted adapter is opt-in per run (`--reasoner hosted`) and never selected
automatically. When it is used, the evidence records it, so it is always clear
whether an artifact was produced with data sent off the machine.

The model is also constrained by construction: its output schema only admits
refs present in the current observation, so it cannot aim at anything the page
does not show, and every action still goes through the gateway.

## Limits

- Screenshots are not masked in v1; acceptable only because the target uses
  synthetic data
- Risk classification by route and control text is per-app configuration and can
  be wrong; it fails closed when in doubt
- Pattern-based redaction cannot catch every novel PII shape; the local default
  limits the exposure to the machine running discovery
- Money amounts outside declared outputs are not masked
- Using the hosted adapter in production would require a data-processing agreement
  with the provider

## Related

- ADR-011 — Guardrail Enforcement at a Single Action Gateway
- ADR-013 — Authentication as Environment Precondition
- ADR-014 — Per-Run Evidence Bundle Layout
- ADR-015 — Local Reasoner with Schema-Constrained Output
- RFC-005 — Human-in-the-Loop Escalation & Session Handoff
