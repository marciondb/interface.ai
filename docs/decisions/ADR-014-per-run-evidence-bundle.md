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
├── intervention.json  # only when the run had a handoff
├── screenshots/       # per step on discovery, on failure and handoff on replay
└── snapshots/         # accessibility snapshots, redacted
```

- The evidence root is configurable via `EVIDENCE_DIR` (default `evidence/runs`,
  git-ignored except for the curated runs)
- Every event has `runId`, `seq`, `timestamp`, and `stepId` where applicable
- Discovery events include the model's `rationale`
- Redaction runs **before** writing, inside the recorder; when the run finishes,
  the recorder redacts every JSON file of the run again with the final set of
  values, so a value learned late is masked in earlier snapshots too
- Declared-sensitive outputs are masked in evidence (`[REDACTED:<sensitivity>]`)
  while still being returned unmasked to the caller
- Curated sample runs are committed under `/evidence/` and indexed in
  `evidence/README.md`

## Consequences

**Positive**
- One folder per run; greppable and diffable
- Failure evidence sits next to the step that failed
- Redaction has a single enforcement point

**Negative**
- Screenshots can show sensitive values, and snapshots show undeclared page data
  (other balances, names); mitigated by capturing only on the fixture with
  synthetic data, and noted as a production gap (masking at capture time)
- No retention or indexing beyond the filesystem

## Alternatives

- **Plain text logs** — rejected: not machine-readable.
- **Tracing backend (OpenTelemetry)** — rejected for v1: infrastructure with no
  added value at this scope; the event schema maps to spans later.

## Related

- ADR-009 — Discriminated-Union Execution Result Contract
- ADR-012 — Same-Session Control Transfer for Human Handoff
- RFC-006 — Safety, Guardrails & Regulated Data Handling
