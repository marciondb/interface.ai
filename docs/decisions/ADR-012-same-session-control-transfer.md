# Same-Session Control Transfer for Human Handoff

| Field | Value |
|---|---|
| **ADR** | ADR-012 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Human handoff happens in the same live browser session the automation was using. A single control owner is tracked, the gateway refuses automation actions while a human holds control, and the human's actions are captured as evidence. |

---

## Context

When automation cannot proceed, a human must act on the **same** session — a fresh
one would lose authentication and progress. There must always be exactly one party
in control.

## Decision

- The browser runs **headed** only when the CLI gets `--headed`; its window is the
  operator surface in v1. Without an operator window, an escalation ends
  immediately with an `escalated` result (`no_operator_surface`)
- A **control owner** value (`automation | human`) is held by the escalation
  controller; the gateway rejects every automation action except `read` unless the
  owner is `automation`
- Escalation happens at a risky step, when discovery stalls or the model asks for
  help, and, in replay, at a failure a human may get past when an operator window
  exists
- On escalation: write an intervention request, set owner to `human`, start
  capturing human actions, and wait
- Human actions are captured by page-level listeners (clicks, field changes) and the
  driver's frame-navigation events (origin and path only), plus before/after snapshots; typed values are replaced by `[redacted]` in the
  page before they reach the system
- The operator controls the handoff by typing `take`, `resume`, or `abort` at a
  stdin prompt of the running process; on resume the run re-observes the page,
  verifies the current step's checkpoint, and continues or reports
- A TTL (default 10 minutes, `HANDOFF_TTL_MS`) and a closed browser window both end
  the handoff
- Native dialogs: dismissed while automation holds control and surfaced in the
  next observation; while a human holds control, the operator answers them at the
  terminal and the answer is recorded as a human action

## Consequences

**Positive**
- Real control transfer with an explicit owner, not a pause flag
- Session, cookies, and progress survive the handoff
- Human actions become part of the run's evidence

**Negative**
- The operator must be at the machine running the browser
- The wait is bounded by the process lifetime (ADR-003)

## Alternatives

- **Remote co-browsing (CDP screencast to a web console)** — rejected for v1:
  substantial UI work; documented as the production direction.
- **Fresh session for the human** — rejected: loses state and breaks the audit trail.

## Related

- ADR-003 — Single Process, CLI-First Composition
- ADR-006 — Playwright as the Computer-Use Driver
- ADR-009 — Discriminated-Union Execution Result Contract
- RFC-005 — Human-in-the-Loop Escalation & Session Handoff
