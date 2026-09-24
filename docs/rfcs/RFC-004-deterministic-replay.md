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
   2. If the step is risky, escalate instead of acting (ADR-011)
   3. Execute through the gateway with an explicit timeout
   4. Observe and evaluate the checkpoint
   5. If the checkpoint fails, classify the observation (below)
4. Extract outputs and return `succeeded`

No step consults a model. The replay controller has no dependency on the reasoner.

## Classification

When a checkpoint does not hold, the outcome classifier (pure Logic) checks, in
order:

| Check | Classification | Response |
|---|---|---|
| Matches a declared `business` outcome | Business outcome | Stop, return `business_outcome` |
| Matches a declared `recoverable` condition | Recoverable | Apply its recovery, retry the step (max 2) |
| Timeout while loading | Recoverable | Retry with backoff (max 2) |
| Session expired | Recoverable | Re-authenticate once, retry the step |
| Server error page | Hard failure | Return `failed` |
| Target not found / ambiguous | Hard failure or escalate | Escalate if configured, else `failed` |
| Anything else | Hard failure | Return `failed` with expected vs observed |

Recoveries are recorded in `result.recoveries[]`.

## Result

The discriminated union from ADR-009. Failures always include `stepId`, `code`,
`expected`, `observed`, and a pointer to the evidence screenshot.

## Mapping to the target's injectable faults

| Fault | Expected handling |
|---|---|
| `slow_load` | Recoverable: retry after timeout |
| `interstitial` | Recoverable: declared recovery clicks Continue |
| `session_expired` | Recoverable once: re-authenticate |
| `server_error` | Hard failure |
| `element_missing` | Hard failure or escalate |

## Non-Goals

- Model-assisted recovery (a possible bounded extension, never open-ended)
- Rollback of partially completed write flows

## Related

- ADR-006 — Playwright as the Computer-Use Driver
- ADR-008 — Ordered Locator Candidate Chain
- ADR-009 — Discriminated-Union Execution Result Contract
- ADR-013 — Authentication as Environment Precondition
- RFC-002 — Capability Artifact: Schema & Contract
