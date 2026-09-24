# Design write-up

The model discovers a flow once, the result becomes a typed, versioned capability, and
replay executes it with no model. Depth is in [`docs/`](docs/README.md).

## 1. Architecture

Two phases in one TypeScript CLI process: `discover` (model in the loop) and `replay`
(no model). The code follows a Diplomat layering: pure models and logic
(policy, checkpoints, classification, redaction, synthesis), controllers that
orchestrate, and diplomats for all I/O (browser, model, store, evidence, operator).
See [RFC-001](docs/rfcs/RFC-001-system-scope-and-component-landscape.md) and
[ADR-001](docs/decisions/ADR-001-diplomat-architecture.md).

- **Replay cannot reach the model.** A dependency-cruiser rule in `npm run verify`
  fails the build if `src/controllers/replay*` reaches `src/diplomat/reasoner/`, even
  transitively. The guarantee is structural, not a flag.
- **One action gateway.** Every action on both paths goes through it; it is where
  policy and control ownership are enforced
  ([ADR-011](docs/decisions/ADR-011-single-action-gateway.md)).
- **Perception is the accessibility tree** (per frame, via Playwright), not raw DOM
  or pixels: it works through iframes and non-semantic markup and has desktop
  equivalents ([ADR-005](docs/decisions/ADR-005-accessibility-tree-first-perception.md),
  [ADR-006](docs/decisions/ADR-006-playwright-driver.md)).
- **Local model by default:** `qwen3:14b` on Ollama, output constrained to a per-step
  JSON Schema whose `target` is an enum of the refs on screen, so an invented element
  cannot be generated. `qwen3:8b` failed the first live decision 3/3; `qwen3:14b`
  passed 3/3. A hosted OpenAI-compatible adapter is opt-in per run
  ([ADR-015](docs/decisions/ADR-015-local-reasoner-schema-constrained.md),
  [RFC-003](docs/rfcs/RFC-003-discovery-agent-loop.md)).
- **Real discoveries:** the read flow took 6 decisions in 27 s; the write flow 13
  decisions in 68 s, including a handoff ([evidence](evidence/README.md)).
- **Trade-offs:** one session at a time, no durable run history, a handoff bounded by
  the process lifetime ([ADR-003](docs/decisions/ADR-003-single-process-cli-composition.md));
  a local model is slower and weaker, which the constrained decision offsets.

## 2. Artifact schema

A capability is a JSON contract validated by a Zod schema
([RFC-002](docs/rfcs/RFC-002-capability-artifact-schema.md)): `capability` (id,
semver, description, app), `preconditions`, typed `inputs` and `outputs` (each with a
`sensitivity`), named `targets`, ordered `steps`, declared `outcomes`, `provenance`.
Excerpt of the discovered
[`member.read-account-balance@1.0.1`](capabilities/member.read-account-balance/1.0.1.json), reformatted:

```json
"targets": {
  "content.memberId": { "frame": "content", "candidates": [
    { "strategy": "label", "text": "Member ID:" },
    { "strategy": "attribute", "name": "name", "value": "ctl00$ContentPlaceHolder1$txtMemberId" },
    { "strategy": "attribute", "name": "id", "value": "ctl00_ContentPlaceHolder1_txtMemberId" } ] },
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
  structure), ids last; the input above has no accessible name, so its chain starts at
  the adjacent label ([ADR-008](docs/decisions/ADR-008-ordered-locator-candidate-chain.md)).
- **Every step has a checkpoint**, and a step's `risk` is part of the contract.
- **Outcomes are declared** (business or recoverable, with a detector), never
  inferred, so "no such member" is a typed answer.
- **Deterministic parameterization:** values equal to an input's `example` become
  `{{inputs.x}}`; synthesis is a pure function of the trace, not the transcript.
- **Versioned and immutable:** one file per semver, never overwritten; callers ask
  for a major (`@1`); review is the git diff of the new file
  ([ADR-007](docs/decisions/ADR-007-artifact-format-and-versioning.md)).

## 3. Determinism & error handling

Replay loads and validates the artifact and inputs, signs in, then for each step
resolves the target, acts through the gateway with an explicit timeout, and checks the
checkpoint. When resolution, the action or the checkpoint fails, a pure classifier
decides what the page means ([RFC-004](docs/rfcs/RFC-004-deterministic-replay.md)).
The result is a discriminated union
([ADR-009](docs/decisions/ADR-009-discriminated-union-result-contract.md)):
`succeeded` (outputs), `business_outcome`, `failed` (`stepId`, `code`, `expected`,
`observed`, evidence pointer) or `escalated`, each with `recoveries[]` and
`interventions[]`; CLI exit codes 0/2/3/4.

| Class | Detected by | Response | Fixture fault |
|---|---|---|---|
| Business outcome | a declared detector (e.g. "No records found.", validation text) | stop, `business_outcome` | data-driven (99999, deposit < 25.00) |
| Recoverable | declared condition, timeout, session expiry | declared recovery, retry with backoff (max 2), or re-login once and restart | `interstitial`, `slow_load`, `session_expired` |
| Hard failure | server error page, target missing or ambiguous, anything else | stop, `failed` with expected vs observed and a screenshot | `server_error`, `element_missing` |

- **No guessing:** a candidate is used only if it matches exactly one element; zero
  or several matches fall through the chain and end as `target_not_found` or
  `target_ambiguous`.
- **Native dialogs** raised under automation are dismissed and surface in the next
  observation instead of blocking the page.
- **Drift (secondary):** replay records which candidate matched; a fallback is
  visible in the log, but there is no self-healing.
- **Proof:** `npm run demo` runs all these classes plus a handoff and an escalation
  with no model; the runs are in [`evidence/`](evidence/README.md).

## 4. Heterogeneity & multi-tenant

Design only; the seams exist in code
([RFC-007](docs/rfcs/RFC-007-surface-abstraction-and-multi-tenant.md)).

- **Surface seam:** the `SurfaceDriver` port (`observe`, `resolve`, `perform`,
  `inspect`, `screenshot`). The artifact speaks in roles, names, labels and table
  structure, with frames part of the target; legacy web is the implemented case, and a
  desktop app needs a new driver (UI Automation, macOS AX) with the same role/name
  model. Surfaces with no accessibility (Citrix, canvas) would add a last-resort visual
  candidate. Artifacts, replay, policy and classification do not change.
- **Multi-tenant reuse:** one base artifact per vendor product version plus a
  per-tenant overlay that may replace only targets and outcome detectors, never steps,
  inputs or outputs, so the contract an agent calls is identical across tenants. The
  effective artifact is validated like any other.
- **Drift management:** a tenant that keeps matching lower candidates, or whose
  checkpoints start failing after a vendor upgrade, signals a new base version or an
  overlay; synthesis already orders semantic candidates before tenant-specific ids.
- **Not built:** desktop drivers, overlays, tenant registry, drift reports.

## 5. Escalation & handoff

[RFC-005](docs/rfcs/RFC-005-human-in-the-loop-handoff.md),
[ADR-012](docs/decisions/ADR-012-same-session-control-transfer.md).

- **Detecting "stuck":** in discovery, three steps without progress (unchanged page,
  rejected ref, denial) or the model's `request_help`; on both paths, a step marked
  `risky` or an action the gateway answers with `requires_human`.
- **Routing:** an intervention request (capability, step, reason, URL, screenshot,
  expiry) is written to `intervention.json` and printed to the operator.
- **Control model:** one owner at a time (`automation` or `human`), held by the
  escalation controller and enforced in the gateway, which refuses every automation
  action except `read` while a human holds control.
- **Same live session:** the operator types `take` and works in the run's own headed
  browser window; tests assert the session cookie is unchanged and there is one sign-in.
- **Handing back:** `resume` re-observes and verifies the step's checkpoint (if it
  fails, control returns to the human). `abort`, TTL expiry (10 min default), a closed
  window, or no `--headed` window end the run as `escalated` with that reason.
- **Recording:** clicks, navigations (no query string), typed values as `[redacted]`
  and dialog answers become `handoff_*` events, with before/after screenshots. In
  discovery, a human's single click becomes a `risky` step of the artifact.
- **Mocked:** the operator console is the headed window plus a stdin prompt. In
  production, a web console streams the session (CDP screencast) and queues requests
  for operators to claim; the control model is the same. The committed handoffs were
  performed by a scripted operator through the real prompt and page.

## 6. Safety

[RFC-006](docs/rfcs/RFC-006-safety-guardrails.md),
[ADR-013](docs/decisions/ADR-013-authentication-as-precondition.md),
[ADR-014](docs/decisions/ADR-014-per-run-evidence-bundle.md).

- **Allowlist:** [`policy.json`](policy.json) lists origins, routes and action types;
  anything else is denied at the gateway before the driver is called.
- **Risk classes:** an action is risky if its control text, destination or current
  page matches the policy's risky list; precedence is deny > `requires_human` > allow,
  and a policy without a risky list fails to load. Risky actions are **blocked for
  automation and done by a human** in the live session: a confirmation answered by
  the automation itself protects nothing, while a handoff puts a named person on the
  irreversible step, on the record. A step's `risk` in the artifact is honored even
  if the policy changes.
- **Secrets:** sign-in happens over HTTP before the browser opens, so credentials never
  enter the page, observations, artifacts or evidence; the password is also masked by
  value everywhere.
- **Sensitive data:** declared inputs and outputs are masked by `sensitivity`, plus
  account-number and SSN patterns, before an observation reaches the model and before
  anything is written. Outputs reach the caller unmasked, on stdout only.
- **Residency:** the local default keeps observations on the machine.
- **Limits:** screenshots are not masked (acceptable only with synthetic data);
  classifying risk by text and route is per-app configuration and can be wrong;
  pattern redaction cannot catch every PII shape; amounts outside declared outputs are
  not masked; the operator must be at the machine running the browser.

## 7. Cuts

Deliberately left out:

- Operator console, request queue and remote co-browsing
- Desktop drivers, tenant overlays and drift reporting (designed, section 4)
- Escalating an unrecoverable replay condition to a human instead of failing
- Branches, loops or composition inside an artifact
- Rollback of partially completed writes (a re-login restart re-runs earlier steps;
  the irreversible one is human-only)
- Durable run history and concurrent runs
- Screenshot masking, model-assisted recovery, multi-run stability, approval states
  (review is the git diff)

Next, in order: mask screenshots at capture time (the blocker for real data); an
operator console with a queue and optional escalation on hard failures; tenant
overlays with a drift report built from the recorded candidate indexes; a run service
with durable history; a bounded, policy-checked single-step model recovery; a Windows
UI Automation driver.
