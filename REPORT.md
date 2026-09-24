# Design write-up

The model discovers a flow once, the result becomes a typed, versioned capability, and
replay executes it with no model. Depth is in [`docs/`](docs/README.md).

## 1. Architecture

Two phases in one TypeScript CLI process: `discover` (model in the loop, from a
natural-language `--goal` or a request file) and `replay` (no model). The code follows
a Diplomat layering: pure models and logic (policy, classification, redaction,
synthesis), controllers that orchestrate, and diplomats for all I/O. One
composition root wires the CLIs, the test harnesses and the demo
([RFC-001](docs/rfcs/RFC-001-system-scope-and-component-landscape.md),
[ADR-001](docs/decisions/ADR-001-diplomat-architecture.md)).

- **Replay cannot reach the model.** A dependency-cruiser rule in `npm run verify`
  fails the build if any replay code reaches `src/diplomat/reasoner/`, even
  transitively: structural, not a flag.
- **One action gateway.** Every action on both paths goes through it; it is where
  policy and control ownership are enforced
  ([ADR-011](docs/decisions/ADR-011-single-action-gateway.md)).
- **Perception is the accessibility tree** (per frame, via Playwright), not raw DOM
  or pixels: it survives iframes and non-semantic markup and exists on desktop
  ([ADR-005](docs/decisions/ADR-005-accessibility-tree-first-perception.md),
  [ADR-006](docs/decisions/ADR-006-playwright-driver.md)).
- **Local model by default:** `qwen3:14b` on Ollama, output constrained to a per-step
  JSON Schema whose `target` is an enum of the refs on screen, so an invented element
  cannot be generated; temperature 0 (`qwen3:8b` failed the first live decision 3/3,
  `qwen3:14b` passed 3/3). A hosted OpenAI-compatible adapter is opt-in
  ([ADR-015](docs/decisions/ADR-015-local-reasoner-schema-constrained.md),
  [RFC-003](docs/rfcs/RFC-003-discovery-agent-loop.md)).
- **Real discoveries:** read flow, 6 decisions in 31 s; write flow, 13 in 45 s with
  one handoff at `Confirm`; each decision logs its rationale, latency and token counts
  ([evidence](evidence/README.md)).
- **Trade-offs:** one session at a time, no durable run history, a handoff bounded by
  the process ([ADR-003](docs/decisions/ADR-003-single-process-cli-composition.md));
  a local model is weaker, which the constrained output offsets.

## 2. Artifact schema

A capability is a JSON contract validated by a Zod schema
([RFC-002](docs/rfcs/RFC-002-capability-artifact-schema.md)): `status`, `capability` (id,
semver, description, app with an optional `productVersion`), `preconditions`, typed
`inputs` and `outputs` (each with a `sensitivity`), named `targets`, ordered `steps`,
declared `outcomes`, `provenance`. Excerpt of the discovered
[`member.read-account-balance@1.0.2`](capabilities/member.read-account-balance/1.0.2.json), abridged:

```json
"targets": {
  "content.memberId": { "frame": "content", "candidates": [
    { "strategy": "label", "text": "Member ID:" },
    { "strategy": "attribute", "name": "name", "value": "ctl00$ContentPlaceHolder1$txtMemberId" } ] },
  "content.balance": { "frame": "content", "candidates": [
    { "strategy": "table_cell", "row": { "column": "Acct Type", "equals": "{{inputs.accountType}}" }, "column": "Balance" } ] }
},
"steps": [
  { "id": "fill-member-id", "action": { "kind": "fill", "target": "content.memberId", "value": "{{inputs.memberId}}" },
    "risk": "safe", "checkpoint": { "kind": "value_equals", "target": "content.memberId", "value": "{{inputs.memberId}}" } },
  { "id": "read-balance", "action": { "kind": "read", "target": "content.balance", "output": "balance" },
    "risk": "safe", "checkpoint": { "kind": "target_visible", "target": "content.balance" } }
]
```

- **Targets are separate from steps**, so a control is described once and a tenant
  overlay can replace targets without touching the flow.
- **Ordered locator candidates**, most semantic first (role/name, label, table
  structure), ids last; discovered targets carry `notes` on why the chain should hold
  ([ADR-008](docs/decisions/ADR-008-ordered-locator-candidate-chain.md)).
- **Every step has a checkpoint**, and a step's `risk` is part of the contract.
- **Outcomes are declared** (business or recoverable, with a detector), never
  inferred, so "no such member" is a typed answer.
- **Deterministic parameterization:** values equal to an input's `example` become
  `{{inputs.x}}`; synthesis is a pure function of the trace, not the transcript.
- **Versioned, immutable, approved:** one file per semver, never overwritten; callers
  ask for a major (`@1`) and get its latest approved version. Discovery writes a
  `draft`, which replay skips unless `--allow-draft`; a reviewer reads the git diff
  and sets `approved` ([ADR-007](docs/decisions/ADR-007-artifact-format-and-versioning.md)).

## 3. Determinism & error handling

Replay validates the artifact and inputs, signs in, then per step resolves the target,
acts through the gateway with a timeout, and checks the checkpoint; on any failure a
pure classifier decides what the page means
([RFC-004](docs/rfcs/RFC-004-deterministic-replay.md)).
The result is a discriminated union
([ADR-009](docs/decisions/ADR-009-discriminated-union-result-contract.md)):
`succeeded` (outputs), `business_outcome`, `failed` (`stepId`, `code`, `expected`,
`observed`, evidence path relative to the run folder) or `escalated`, each with
`recoveries[]` and `interventions[]`; CLI exit codes 0/2/3/4 (1 usage, 5 internal error).

| Class | Detected by | Response | Fixture fault |
|---|---|---|---|
| Business outcome | a declared detector (e.g. "No records found.", validation text) | stop, `business_outcome` | data-driven (99999, deposit < 25.00) |
| Recoverable | declared condition, timeout, session expiry, native dialog | declared recovery, retry with backoff (max 2), re-login once and restart, or dismiss the dialog; each recorded in `recoveries[]` | `interstitial`, `slow_load`, `session_expired`, `unexpected_dialog` |
| Hard failure | server error page, target missing or ambiguous, anything else | `failed` with expected vs observed and a screenshot; with an operator window, a target or checkpoint problem goes to a human first | `server_error`, `element_missing` |

- **No guessing:** a candidate counts only on exactly one match; otherwise the chain
  falls through, ending as `target_not_found` or `target_ambiguous`.
- **No double submission:** once a risky step is done, an expired session fails the
  run instead of restarting it.
- **Drift (secondary):** replay records which candidate matched; a fallback is
  visible in the log, but there is no self-healing.
- **Proof:** `npm run demo` replays 8 scenarios with no model; curated runs are in
  [`evidence/`](evidence/README.md).

## 4. Heterogeneity & multi-tenant

Design only; the seams exist in code
([RFC-007](docs/rfcs/RFC-007-surface-abstraction-and-multi-tenant.md)).

- **Surface seam:** the `SurfaceDriver` port (`observe`, `resolve`, `perform`,
  `inspect`, `screenshot`). The artifact speaks in roles, names, labels, table
  structure and frames; legacy web is implemented, and a desktop app needs only a
  driver with the same role/name model (UI Automation, macOS AX). Surfaces with no
  accessibility (Citrix, canvas) would add a last-resort visual candidate.
- **Multi-tenant reuse:** one base artifact per vendor product version (the optional
  `app.productVersion`) plus a per-tenant overlay that may replace only targets and
  outcome detectors, never steps, inputs or outputs, so the contract an agent calls is
  identical across tenants. The effective artifact is validated like any other.
- **Drift management:** a tenant that keeps matching lower candidates, or whose
  checkpoints fail after an upgrade, needs a new base version or an overlay.

## 5. Escalation & handoff

[RFC-005](docs/rfcs/RFC-005-human-in-the-loop-handoff.md),
[ADR-012](docs/decisions/ADR-012-same-session-control-transfer.md).

- **Detecting "stuck":** in discovery, three steps in a row without progress or the
  model's `request_help`; in replay, a failure a person may get past (section 3); on
  both paths, a `risky` step or a gateway answer of `requires_human`.
- **Routing:** an intervention request (capability or goal, step, reason, URL, masked
  screenshot, expiry) is written to `intervention.json` and printed to the operator.
- **Control model:** one owner at a time (`automation` or `human`); while a human
  holds control the gateway refuses every automation action except `read`.
- **Same live session:** the operator types `take` and works in the run's own headed
  window; tests assert an unchanged session cookie and a single sign-in.
- **Handing back:** `resume` re-observes and verifies the step's checkpoint; if it
  fails, the human keeps control. `abort`, TTL expiry (10 min), a closed window, or no
  `--headed` window end the run as `escalated` with that reason.
- **Recording:** clicks, navigations, typed values as `[redacted]` and dialog answers
  become `handoff_*` events with before/after screenshots; in discovery, the human's
  click becomes the artifact's `risky` step.
- **Telling a stateless model:** the goal line says what a person did (`a person
  already did: click button "Confirm"`) and the prompt forbids repeating it; a live
  run without this sent the model back toward the confirm page (the gateway held it).
- **Mocked:** the console is the headed window plus a stdin prompt; production would
  stream the session and queue requests with the same control model. Committed
  handoffs were done by a scripted operator through the real prompt and page.

## 6. Safety

[RFC-006](docs/rfcs/RFC-006-safety-guardrails.md),
[ADR-013](docs/decisions/ADR-013-authentication-as-precondition.md),
[ADR-014](docs/decisions/ADR-014-per-run-evidence-bundle.md).

- **Allowlist:** [`policy.json`](policy.json) lists origins, routes and action types;
  anything else is denied at the gateway before the driver is called.
- **Risk classes:** an action is risky if its control text, destination or current
  page matches the policy's risky list; precedence is deny > `requires_human` > allow.
  Risky actions are **blocked for automation and done by a human** in the live
  session: a confirmation the automation answers itself protects nothing, while a
  handoff puts a named person on the irreversible step. A step's `risk` in the
  artifact holds even if the policy changes.
- **Secrets:** sign-in happens over HTTP before the browser opens, so credentials never
  enter the page, observations, artifacts or evidence; the password is masked anyway.
- **Sensitive data:** declared sensitive inputs and outputs show as
  `[REDACTED:<sensitivity>]` in every evidence JSON file and are boxed in every
  screenshot; in text, account numbers keep their last 4 digits and SSNs are masked.
  The model sees secrets and every sensitive output read so far masked, but inputs in
  clear, since it must type them. Outputs reach the caller unmasked, on stdout only;
  the local model keeps observations on the machine.
- **Limits:** undeclared page data (a name, balances not read) stays visible, and
  screenshot boxes cover declared values only; risk by text and route is per-app
  configuration and can be wrong; the operator must be at the browser's machine.

## 7. Cuts

Deliberately left out:

- Operator console, request queue and remote co-browsing
- Desktop drivers, a second tenant, overlays and drift reports (designed, section 4)
- Branches, loops or composition inside an artifact
- Rollback of partially completed writes
- Durable run history and concurrent runs
- Model-assisted recovery, multi-run stability, confidence scores (approval is manual)

Next, in order: redaction of undeclared page data, in text and screenshots (the
blocker for real data); an operator console with a queue; tenant overlays with a
drift report from the recorded candidate indexes; a run service with durable history;
a bounded, policy-checked single-step model recovery; a Windows UI Automation driver.
