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
replay --capability member.read-account-balance@1 --input memberId=10002 --input accountType=Savings [--target <url>] [--headed] [--allow-draft]
```

## Execution

1. Resolve `<id>@<major>` to the latest approved version of that major (drafts
   only with `--allow-draft`), load and validate it (ADR-007); validate inputs
   against its contract
2. Ensure preconditions (session provider, ADR-013)
3. For each step:
   1. Resolve the target through its candidate chain (ADR-008)
   2. Escalate instead of acting if the step is `risky` in the artifact or the
      gateway returns `requires_human` (ADR-011)
   3. Execute through the gateway with an explicit timeout
      (`REPLAY_STEP_TIMEOUT_MS`, default 5 s). The same budget bounds how long
      target resolution and the checkpoint keep polling; each single observation
      of the page has its own fixed 5 s limit in the driver, so a step can
      overrun the budget by one observation
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
| Matches a declared `recoverable` condition | Recoverable | Apply its recovery (or wait, if it declares none), retry the step (max 2) |
| Timeout while loading | Recoverable | Retry with backoff (max 2) |
| Session expired | Recoverable | Re-authenticate once, restart from the first step; refused once a risky step is done |
| Server error page | Hard failure | Return `failed` |
| Target not found / ambiguous | Hard failure | Hand to a human, else return `failed` (below) |
| Anything else | Hard failure | Hand to a human, else return `failed` with expected vs observed (below) |

A failure a person may get past — `target_not_found`, `target_ambiguous`,
`checkpoint_failed`, `recovery_exhausted` — is handed to a human once per step
when an operator window exists (`--headed`), with reason `unrecoverable`
(RFC-005). If they resume and the step's checkpoint holds, the run continues;
otherwise, or without a window, the run returns `failed`. A declared recovery
whose control policy calls risky is handed to a human too (`risky_action`).

Recoveries are recorded in `result.recoveries[]`, one entry per recovery:
`outcome` (`declared_recovery` or `retry`), `timeout` (`retry`),
`session_expired` (`reauthenticate`), and `unexpected_dialog` (`dismissed`: a
native dialog the driver dismissed during a step that still completed).

## Result

The discriminated union from ADR-009. Failures always include `stepId`, `code`,
`expected`, `observed`, and an `evidence` path relative to the run folder: the
failure screenshot, else the snapshot, else `.` (the run folder itself) when
nothing could be captured, e.g. before the surface opened. The sign-in screen is
never photographed (a target may display credentials on it); there the pointer
is the redacted snapshot.

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
| 5 | Internal error (a crash, not a result of the run) |

## Mapping to the target's injectable faults

Every fault fires exactly once, on the next request (the sign-in request
included), and then clears; `unexpected_dialog` waits for the next HTML page.

| Fault | Fixture behavior | Expected handling |
|---|---|---|
| `slow_load` | Response delayed ~8 s | Recoverable: a ~5 s step timeout catches it; the timed-out load is abandoned and the retry succeeds |
| `interstitial` | Maintenance notice with Continue | Recoverable: declared recovery clicks Continue |
| `session_expired` | Session destroyed, redirect to login | Recoverable once: re-login and restart from the first step (not after a risky step) |
| `server_error` | HTTP 500 error page | Hard failure |
| `element_missing` | Primary submit (Search) removed | Hard failure: resolving it fails, `target_not_found`; with `--headed` the step is first handed to a human (`unrecoverable`) |
| `unexpected_dialog` | Native alert on the next page | Recoverable: the driver dismisses it; recorded as an `unexpected_dialog` recovery |

## Non-Goals

- Model-assisted recovery (a possible bounded extension, never open-ended)
- Rollback of partially completed write flows

## Related

- ADR-006 — Playwright as the Computer-Use Driver
- ADR-008 — Ordered Locator Candidate Chain
- ADR-009 — Discriminated-Union Execution Result Contract
- ADR-013 — Authentication as Environment Precondition
- RFC-002 — Capability Artifact: Schema & Contract
