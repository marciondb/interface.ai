# Ordered Locator Candidate Chain

| Field | Value |
|---|---|
| **ADR** | ADR-008 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Each target control in an artifact is identified by an ordered list of locator candidates, resolved in order, where a candidate counts only if it matches exactly one element. |

---

## Context

Legacy surfaces have no test identifiers, and generated ids can differ per tenant.
No single locator strategy is reliable everywhere, but replay must be deterministic.

## Decision

A target declares an ordered chain of candidates, most semantic first:

1. **`role`** — role + accessible name, e.g. `textbox "Member ID"`
2. **`label`** — the control's associated label (exact match); failing that, in
   table layouts, the control or displayed value in the cell right after the cell
   whose text is exactly the label
3. **`attribute`** — a stable attribute, e.g. `name` or `id`
4. **`text`** — exact text content, for links and buttons
5. **`table_cell`** — e.g. "the cell in the row where column `Acct Type` equals
   `Savings`, column `Balance`"

A target may also name the frame it lives in and carry reviewer-facing `notes`.

Resolution rules:

- Candidates are tried in declared order
- A candidate succeeds only on **exactly one** match; zero or many means try the next
- If none succeeds, the step fails with every candidate's match count in the error
- The candidate that matched is recorded in evidence

The order is fixed in the artifact, so replay is deterministic: same page, same
candidate, same element.

## Consequences

**Positive**
- Survives single-attribute changes, including per-tenant id differences (by
  design; the fixture defines a single tenant)
- Ambiguity is a failure, never a guess
- Falling back to a lower candidate is a drift signal operators can monitor

**Negative**
- Artifacts are more verbose
- A lower candidate can match the wrong element if the page changed substantially;
  checkpoints are the backstop

## Alternatives

- **Single best selector** — rejected: one attribute change breaks the capability.
- **Self-healing via model at replay time** — rejected: puts a model back in the
  decision loop.

## Related

- ADR-005 — Accessibility-Tree-First Perception Model
- RFC-002 — Capability Artifact: Schema & Contract
- RFC-004 — Deterministic Replay & Execution Result Contract
