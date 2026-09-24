# Per-Run Evidence Bundle Layout

| Field | Value |
|---|---|
| **ADR** | ADR-014 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Each run writes a self-contained, redacted directory with a JSONL event log, the final result, and screenshots and snapshots, so one folder is enough to understand or debug a run. |

---

## Context

Evidence must let someone reconstruct what happened and why, and must never
contain secrets or raw sensitive values.

## Decision

```text
evidence/runs/<timestamp>-<mode>-<capability-id>/
├── run.jsonl          # one event per line: observation, decision, action, policy, checkpoint, recovery, handoff
├── result.json        # the ExecutionResult (ADR-009)
├── artifact.json      # discovery only: the produced capability
├── screenshots/       # per step on discovery, on failure and handoff on replay
└── snapshots/         # accessibility snapshots, redacted
```

- Every event has `runId`, `seq`, `timestamp`, and `stepId` where applicable
- Discovery events include the model's `rationale`
- Redaction runs **before** writing, inside the recorder
- Sample runs are committed under `/evidence/`

## Consequences

**Positive**
- One folder per run; greppable and diffable
- Failure evidence sits next to the step that failed
- Redaction has a single enforcement point

**Negative**
- Screenshots can show sensitive values; mitigated by capturing only on the fixture
  with synthetic data, and noted as a production gap (masking at capture time)
- No retention or indexing beyond the filesystem

## Alternatives

- **Plain text logs** — rejected: not machine-readable.
- **Tracing backend (OpenTelemetry)** — rejected for v1: infrastructure with no
  added value at this scope; the event schema maps to spans later.

## Related

- ADR-009 — Discriminated-Union Execution Result Contract
- RFC-006 — Safety, Guardrails & Regulated Data Handling
