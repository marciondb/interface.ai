# Capability Artifact: Schema & Contract (v1)

---

| Field | Value |
|---|---|
| **RFC** | RFC-002 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Defines the capability artifact: the typed, versioned contract produced by discovery and executed by replay. |

---

## Context

The artifact turns a recorded run into something an agent can call by name. It must
be a contract — inputs, outputs, success conditions, known outcomes — not just a
list of clicks. It is read by humans in review and by agents at invocation time.

## Shape

Illustrative; the Zod schema in code is canonical (ADR-007).

```json
{
  "schemaVersion": 1,
  "status": "approved",
  "capability": {
    "id": "member.read-account-balance",
    "version": "1.0.0",
    "description": "Look up a member and read the balance of one account type",
    "app": { "product": "legacy-member-console", "surface": "web" }
  },
  "preconditions": [{ "kind": "authenticated_session" }],
  "inputs": {
    "memberId": { "type": "string", "description": "Member ID, digits only", "pattern": "^[0-9]{1,12}$", "sensitivity": "internal" },
    "accountType": { "type": "string", "description": "Account type to read", "enum": ["Checking", "Savings", "Money Market"], "sensitivity": "none" }
  },
  "outputs": {
    "balance": { "type": "string", "description": "Balance as displayed", "sensitivity": "financial" }
  },
  "targets": {
    "lookup.memberId": {
      "frame": "content",
      "candidates": [
        { "strategy": "label", "text": "Member ID:" },
        { "strategy": "attribute", "name": "name", "value": "ctl00$ContentPlaceHolder1$txtMemberId" }
      ]
    },
    "detail.balance": {
      "frame": "content",
      "candidates": [
        { "strategy": "table_cell", "row": { "column": "Acct Type", "equals": "{{inputs.accountType}}" }, "column": "Balance" }
      ]
    },
    "interstitial.continue": {
      "frame": "content",
      "candidates": [{ "strategy": "role", "role": "button", "name": "Continue" }]
    }
  },
  "steps": [
    {
      "id": "enter-member-id",
      "action": { "kind": "fill", "target": "lookup.memberId", "value": "{{inputs.memberId}}" },
      "risk": "safe",
      "checkpoint": { "kind": "value_equals", "target": "lookup.memberId", "value": "{{inputs.memberId}}" }
    },
    {
      "id": "read-balance",
      "action": { "kind": "read", "target": "detail.balance", "output": "balance" },
      "risk": "safe",
      "checkpoint": { "kind": "value_matches", "target": "detail.balance", "pattern": "^[0-9,]+\\.[0-9]{2}$" }
    }
  ],
  "outcomes": [
    { "id": "member_not_found", "kind": "business", "when": { "kind": "text_visible", "text": "No records found." } },
    { "id": "member_restricted", "kind": "business", "when": { "kind": "text_visible", "text": "not authorized" } },
    { "id": "interstitial", "kind": "recoverable", "when": { "kind": "text_visible", "text": "Click Continue to proceed" }, "recover": { "kind": "click", "target": "interstitial.continue" } }
  ],
  "provenance": {
    "method": "discovered",
    "createdAt": "…",
    "runId": "…",
    "reasoner": { "adapter": "local", "model": "…" }
  },
  "notes": "…"
}
```

The Member ID input has no accessible name in the target, so its chain starts at
`label` rather than `role`.

## Sections

| Section | Purpose |
|---|---|
| `status` | Optional review state, `draft` \| `approved`; absent means `approved`. Discovery writes `draft`; replay skips drafts unless run with `--allow-draft` |
| `capability` | Identity, semver, human description, which app and surface (`app.product`, `app.surface`, optional `app.productVersion`) |
| `preconditions` | What must hold before running (ADR-013) |
| `inputs` / `outputs` | Typed contract for the caller (`string` \| `number`, a `description`, a `sensitivity` class used by redaction: `none` \| `internal` \| `pii` \| `financial`); string inputs may add `pattern` and `enum`. All inputs are required |
| `targets` | Named controls with an optional `frame` (absent = top-level document), ordered locator candidates (ADR-008) and optional `notes` (discovery writes why the chain is robust). Steps refer to targets by name |
| `steps` | Ordered actions, each with a `risk` class (`safe` \| `risky`), a `checkpoint` and optional `notes` |
| `outcomes` | Declared business outcomes and recoverable conditions, each with an optional `description` and a detector; a recoverable condition may declare a `recover` click |
| `provenance` | How the artifact was made: `method` (`discovered` \| `hand_written`), `createdAt`, and for `discovered` a `runId` linking to the discovery run evidence and a `reasoner` (`adapter` `local` \| `hosted`, `model`) |
| `notes` | Optional free-text notes for reviewers |

Vocabulary:

- **Locator strategies:** `role`, `label` (the control associated with that
  label, else the value in the table cell right after the label's cell),
  `attribute`, `text`, `table_cell` (the cell in column Y of the row where column
  X equals a value; with an optional `role`, the element of that role inside it).
  A candidate counts only when it matches exactly one element
- **Checkpoint and detector kinds:** `text_visible`, `target_visible`,
  `value_equals`, `value_matches`
- **Step actions:** `click`, `fill`, `select`, `press`, `navigate` (a `path`
  relative to the target's origin), `read`

Beyond the schema, the artifact is validated for internal consistency: every
referenced target exists, every placeholder names a declared input, each output
is produced by exactly one `read`, step and outcome ids are unique, and unknown
keys are rejected. `discovered` provenance requires `runId` and `reasoner`. The
store also checks that a file's id and version match its path
(`capabilities/<id>/<version>.json`).
Placeholders are only `{{inputs.<name>}}`; they may appear in targets, steps and
outcomes, except inside any `value_matches` pattern, whether a checkpoint or an
outcome detector (an input would become unchecked regex syntax), and are bound to the caller's validated inputs before replay.

## Design notes

- **Targets are separate from steps** so the same control is described once, and
  per-tenant overrides could replace targets without touching steps (RFC-007,
  design only).
- **Published versions are immutable.** The store refuses to overwrite an
  existing version; a change is a new version.
- **Every step has a checkpoint.** Replay never assumes an action worked.
- **Outcomes are declared, not inferred.** Replay reports a business outcome only if
  it is listed here (ADR-009).
- **Concrete values become parameters.** Discovery values like `10001` are replaced
  by `{{inputs.memberId}}` during synthesis.
- **No secrets, ever.** Inputs and outputs with sensitivity `secret` are rejected
  by the schema.

## Non-Goals

- Branching or loops inside an artifact
- Composition of capabilities

## Related

- ADR-007 — Artifact Serialization Format and Versioning
- ADR-008 — Ordered Locator Candidate Chain
- ADR-009 — Discriminated-Union Execution Result Contract
- ADR-013 — Authentication as Environment Precondition
- RFC-004 — Deterministic Replay & Execution Result Contract
