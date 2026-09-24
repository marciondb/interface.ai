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
  "capability": {
    "id": "member.read-account-balance",
    "version": "1.0.0",
    "description": "Look up a member and read the balance of one account type",
    "app": { "product": "legacy-member-console", "surface": "web" }
  },
  "preconditions": [{ "kind": "authenticated_session" }],
  "inputs": {
    "memberId": { "type": "string", "pattern": "^[0-9]+$", "sensitivity": "internal" },
    "accountType": { "type": "string", "enum": ["Checking", "Savings", "Money Market"], "sensitivity": "none" }
  },
  "outputs": {
    "balance": { "type": "string", "sensitivity": "financial" }
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
| `capability` | Identity, semver, human description, which app and surface |
| `preconditions` | What must hold before running (ADR-013) |
| `inputs` / `outputs` | Typed contract for the caller, with a `sensitivity` class per field used by redaction |
| `targets` | Named controls with ordered locator candidates (ADR-008). Steps refer to targets by name |
| `steps` | Ordered actions, each with a `risk` class and a `checkpoint` |
| `outcomes` | Declared business outcomes and recoverable conditions, each with a detector |
| `provenance` | How the artifact was made: `method` (`discovered` \| `hand_written`), `createdAt`, optional `runId` linking to the discovery run evidence, optional `reasoner` (`adapter`, `model`) |
| `notes` | Optional free-text notes for reviewers |

Vocabulary:

- **Locator strategies:** `role`, `label`, `attribute`, `text`, `table_cell`
  (the cell in column Y of the row where column X equals a value)
- **Checkpoint and detector kinds:** `text_visible`, `target_visible`,
  `value_equals`, `value_matches`
- **Step actions:** `click`, `fill`, `select`, `press`, `navigate`, `read`

Beyond the schema, the artifact is validated for internal consistency: every
referenced target exists, every placeholder names a declared input, and each
output is produced by exactly one `read`.

## Design notes

- **Targets are separate from steps** so the same control is described once, and
  per-tenant overrides replace targets without touching steps (RFC-007).
- **Every step has a checkpoint.** Replay never assumes an action worked.
- **Outcomes are declared, not inferred.** Replay reports a business outcome only if
  it is listed here (ADR-009).
- **Concrete values become parameters.** Discovery values like `10001` are replaced
  by `{{inputs.memberId}}` during synthesis.
- **No secrets, ever.** Inputs with sensitivity `secret` are rejected by the schema.

## Non-Goals

- Branching or loops inside an artifact
- Composition of capabilities

## Related

- ADR-007 — Artifact Serialization Format and Versioning
- ADR-008 — Ordered Locator Candidate Chain
- ADR-009 — Discriminated-Union Execution Result Contract
- ADR-013 — Authentication as Environment Precondition
- RFC-004 — Deterministic Replay & Execution Result Contract
