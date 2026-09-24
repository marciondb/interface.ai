# Deterministic Replay & Execution Result Contract (v1)

---

| Field | Value |
|---|---|
| **RFC** | RFC-004 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Defines how a capability artifact is executed without a model, how runtime conditions are detected and classified, and what the caller receives. |

---

## Context

Replay is the production path. It must be deterministic, verify every step, and
tell the caller clearly whether it succeeded, hit a legitimate business result,
failed, or needs a human.

## Input

```bash
replay --capability member.read-account-balance@1 --input memberId=10002 --input accountType=Savings
```

## Execution

1. Load and validate the artifact (ADR-007); validate inputs against its contract
2. Ensure preconditions (session provider, ADR-013)
3. For each step:
   1. Resolve the target through its candidate chain (ADR-008)
   2. Escalate instead of acting if the step is `risky` in the artifact or the
      gateway returns `requires_human` (ADR-011)
   3. Execute through the gateway with an explicit timeout
   4. Observe and evaluate the checkpoint
   5. If target resolution, the action, or the checkpoint fails, classify the
      observation (below)
4. Extract outputs and return `succeeded`

No step consults a model. The replay controller has no dependency on the reasoner.

## Classification

Classification runs whenever target resolution, the action, or the checkpoint
fails — not only on checkpoint failure. That is how "No records found." is
caught: the next step's target is absent, and the page matches a declared
business outcome. The outcome classifier (pure Logic) checks, in order:

| Check | Classification | Response |
|---|---|---|
| Matches a declared `business` outcome | Business outcome | Stop, return `business_outcome` |
| Matches a declared `recoverable` condition | Recoverable | Apply its recovery, retry the step (max 2) |
| Timeout while loading | Recoverable | Retry with backoff (max 2) |
| Session expired | Recoverable | Re-authenticate once, restart from the first step |
| Server error page | Hard failure | Return `failed` |
| Target not found / ambiguous | Hard failure or escalate | Escalate if configured, else `failed` |
| Anything else | Hard failure | Return `failed` with expected vs observed |

Recoveries are recorded in `result.recoveries[]`.

## Result

The discriminated union from ADR-009. Failures always include `stepId`, `code`,
`expected`, `observed`, and a pointer to the evidence screenshot. The sign-in
screen is never photographed (a target may display credentials on it); there the
pointer is the redacted snapshot.

Failure codes: `invalid_input`, `artifact_unavailable`, `precondition_failed`,
`policy_denied`, `target_not_found`, `target_ambiguous`, `timeout`,
`session_expired`, `server_error`, `recovery_exhausted`, `checkpoint_failed`,
`driver_error`.

CLI exit codes:

| Code | Meaning |
|---|---|
| 0 | `succeeded` |
| 2 | `business_outcome` |
| 3 | `failed` |
| 4 | `escalated` |
| 1 | Usage or configuration error |

## Mapping to the target's injectable faults

Every fault fires exactly once, on the next request (the sign-in request
included), and then clears.

| Fault | Fixture behavior | Expected handling |
|---|---|---|
| `slow_load` | Response delayed ~8 s | Recoverable: a ~5 s step timeout catches it; the timed-out load is abandoned and the retry succeeds |
| `interstitial` | Maintenance notice with Continue | Recoverable: declared recovery clicks Continue |
| `session_expired` | Session destroyed, redirect to login | Recoverable once: re-login and restart from the first step |
| `server_error` | HTTP 500 error page | Hard failure |
| `element_missing` | Primary submit (Search) removed | Hard failure: resolving it fails, `target_not_found` |

## Non-Goals

- Model-assisted recovery (a possible bounded extension, never open-ended)
- Rollback of partially completed write flows

## Related

- ADR-006 — Playwright as the Computer-Use Driver
- ADR-008 — Ordered Locator Candidate Chain
- ADR-009 — Discriminated-Union Execution Result Contract
- ADR-013 — Authentication as Environment Precondition
- RFC-002 — Capability Artifact: Schema & Contract
