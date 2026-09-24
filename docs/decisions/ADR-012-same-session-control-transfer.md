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

- The browser runs **headed**; its window is the operator surface in v1
- A **control owner** value (`automation | human`) is held by the escalation
  controller; the gateway rejects automation actions unless the owner is
  `automation`
- On escalation: write an intervention request, set owner to `human`, start
  capturing human actions, and wait
- Human actions are captured by page-level listeners (clicks, inputs, navigations)
  plus before/after snapshots, with input values redacted
- The operator signals resume through the CLI; the run re-observes the page,
  verifies the current step's checkpoint, and continues or reports

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
- RFC-005 — Human-in-the-Loop Escalation & Session Handoff
