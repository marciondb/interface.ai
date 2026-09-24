# Discriminated-Union Execution Result Contract

| Field | Value |
|---|---|
| **ADR** | ADR-009 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Replay returns a discriminated union keyed by `status`, so business outcomes, hard failures, and escalations are distinct types rather than variations of an error. Recoverable conditions are handled inside the run and reported alongside the result. |

---

## Context

Callers need to act differently on "member not found", "the app crashed", and "a
human is needed". Conflating a legitimate business result with a failure is the
most common mistake in this kind of system.

## Decision

```ts
type ExecutionResult =
  | { status: "succeeded"; outputs: Record<string, unknown> }
  | { status: "business_outcome"; outcome: string; details?: Record<string, unknown> }
  | { status: "failed"; failure: { stepId: string; code: FailureCode; expected: string; observed: string } }
  | { status: "escalated"; interventionId: string; reason: string }
```

Every result also carries `runId`, `capability` (id + version), `durationMs`, and
`recoveries[]` — the recoverable conditions handled along the way (interstitial
dismissed, slow load retried).

Rules:
- Business outcomes are **declared in the artifact**; an undeclared state is never
  reported as a business outcome
- Business outcomes never throw
- Recoverable conditions are not a terminal status

Consumers switch on `status` with an exhaustive `never` check.

## Consequences

**Positive**
- The compiler forces callers to handle every case
- "Not found" can never be mistaken for a crash
- Failures always say which step, what was expected, what was observed

**Negative**
- Adding a status is a breaking change for callers — intended

## Alternatives

- **Exceptions for failures, return values for success** — rejected: business
  outcomes end up as exceptions or as fake successes.
- **Boolean `ok` plus error string** — rejected: not machine-actionable.

## Related

- RFC-004 — Deterministic Replay & Execution Result Contract
- RFC-005 — Human-in-the-Loop Escalation & Session Handoff
