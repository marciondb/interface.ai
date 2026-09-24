# Human-in-the-Loop Escalation & Session Handoff (v1)

---

| Field | Value |
|---|---|
| **RFC** | RFC-005 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Defines when a run escalates to a human, what the intervention request contains, how control of the live session is transferred and returned, and what is recorded. |

---

## Triggers

- Discovery dead end or `request_help` (RFC-003)
- Replay condition that cannot be recovered and is configured to escalate (RFC-004)
- A step marked risky (ADR-011)

## Intervention request

Written to `evidence/runs/<run>/intervention.json` and printed by the CLI:

```json
{
  "interventionId": "int_…",
  "runId": "…",
  "mode": "replay",
  "goal": "…",
  "capability": "member.open-sub-account@1",
  "stepId": "confirm-open",
  "reason": "risky_action",
  "message": "Step requires human approval: Confirm",
  "screenshot": "screenshots/0007.png",
  "url": "http://localhost:8080/member/subacct/review",
  "requestedAt": "…",
  "expiresAt": "…"
}
```

`mode` is `discovery` or `replay`.

## Control state machine

```mermaid
stateDiagram-v2
    [*] --> Automation
    Automation --> AwaitingHuman: escalate
    AwaitingHuman --> Human: take
    Human --> Verifying: resume
    Verifying --> Automation: checkpoint holds
    Verifying --> Human: checkpoint fails
    AwaitingHuman --> Aborted: abort / TTL / window closed
    Human --> Aborted: abort / TTL / window closed
    Automation --> [*]: result
    Aborted --> [*]: result (escalated)
```

- The operator types `take`, `resume`, or `abort` at the stdin prompt of the
  running process.
- The run moves to Aborted on `abort`, on TTL expiry (default 10 min), or when
  the browser window is closed.
- One owner at a time (ADR-012). The gateway rejects automation actions unless the
  owner is `automation`. While Verifying, automation only observes.
- The operator works in the same headed browser window. Without `--headed` there
  is no operator surface, and the run ends immediately as `escalated`
  (`no_operator_surface`).
- Native dialogs raised during the handoff are answered at the terminal and
  recorded.
- On resume, the run re-observes and verifies the current step's checkpoint before
  continuing — the human's word is not taken on faith.

## What is recorded

- The intervention request
- Human actions (clicks, inputs with values redacted, navigations) with timestamps
- Snapshots before and after the handoff
- Who resumed or aborted, and when

## Mocked in v1

The operator surface is the browser window plus a CLI prompt. The production design
is a web console that streams the session (CDP screencast), queues intervention
requests, and lets any available operator claim one. The control model above does
not change.

## Related

- ADR-003 — Single Process, CLI-First Composition
- ADR-012 — Same-Session Control Transfer for Human Handoff
- ADR-009 — Discriminated-Union Execution Result Contract
- RFC-004 — Deterministic Replay & Execution Result Contract
