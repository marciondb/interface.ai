# Computer-use automation for legacy back-office apps

A language model drives a legacy web app once to reach a goal (**discovery**); the run
becomes a typed, versioned capability artifact; the artifact is then **replayed**
deterministically with no model in the loop, with explicit business outcomes,
recoveries, failures and a human handoff of the live session. The design write-up is
[`REPORT.md`](REPORT.md); the design record is [`docs/`](docs/README.md).

## Requirements

- Node 24 (`.nvmrc`) and npm
- Chromium for Playwright (installed below)
- For discovery only: [Ollama](https://ollama.com) with `qwen3:14b` (about 9 GB of
  disk and 10 GB of free memory), or any OpenAI-compatible endpoint

Tests, the demo and replay need no model, no key and no network.

## Setup

```bash
nvm use                         # Node 24
npm install
npx playwright install chromium
```

### Model setup (discovery only)

```bash
brew install ollama             # or the installer from ollama.com
ollama serve                    # or: brew services start ollama
ollama pull qwen3:14b
```

`qwen3:14b` is the default because `qwen3:8b` failed the first live decision 3 times
out of 3 while `qwen3:14b` got it right 3 out of 3 (ADR-015). To use a hosted model
instead, pass `--reasoner hosted` to `discover` and set `HOSTED_BASE_URL` (an
OpenAI-compatible base URL, e.g. `https://api.openai.com/v1`), `HOSTED_MODEL` and
`HOSTED_API_KEY`. The hosted path is never chosen automatically.

## Configuration

Everything is read from environment variables, and every default targets the local
fixture, so nothing needs to be set. [`.env.example`](.env.example) lists them; nothing
loads `.env` automatically, so export what you change (e.g.
`cp .env.example .env`, edit, then `set -a && . ./.env && set +a`).

| Variable | Default | Used by |
|---|---|---|
| `TARGET_USERNAME`, `TARGET_PASSWORD` | the fixture's demo credentials ([`fixture/README.md`](fixture/README.md)) | sign-in over HTTP before each run (ADR-013) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | `discover` (local) |
| `REASONER_MODEL` | `qwen3:14b` | `discover` (local) |
| `HOSTED_BASE_URL`, `HOSTED_MODEL`, `HOSTED_API_KEY` | unset | `discover --reasoner hosted` |
| `EVIDENCE_DIR` | `evidence/runs` | where each run's evidence folder is written |
| `REPLAY_STEP_TIMEOUT_MS` | `5000` | per-step budget in replay |
| `HANDOFF_TTL_MS` | `600000` (10 min) | how long a handoff waits for the operator |
| `OPERATOR_ID` | `local-operator` | who is recorded as taking and resuming a handoff |

The allowlist is [`policy.json`](policy.json) (origins, routes, action types, risky
routes and control text); it allows `http://localhost:8080`, where `npm run fixture`
listens.

## Run without live services

```bash
npm run verify    # typecheck, lint, tests (fixture on a free port, scripted model), dependency rules
npm run demo      # replays the committed capabilities in six scenarios; no model, no model env
```

`npm run demo` starts the fixture itself, replays against it, and prints one line per
scenario, then `6/6 as expected` (exit 0):

```text
PASS  success                      expected=succeeded  got=succeeded  evidence=…
PASS  business outcome             expected=business_outcome:member_not_found  got=business_outcome:member_not_found  evidence=…
PASS  recovered fault              expected=succeeded+recovery:interstitial  got=succeeded+recovery:interstitial  evidence=…
PASS  hard failure                 expected=failed:server_error@click-member-lookup  got=failed:server_error@click-member-lookup  evidence=…
PASS  handoff (scripted operator)  expected=succeeded+intervention  got=succeeded+intervention  evidence=…
PASS  escalation, no operator      expected=escalated:no_operator_surface@close-account  got=escalated:no_operator_surface@close-account  evidence=…
```

Faults are injected through the fixture's `/_fault` endpoint right before the step
they target; the handoff scenario uses a scripted operator that types `take` and
`resume` at the real handoff prompt and clicks in the run's own page. Evidence goes to
a temp dir; `npm run demo -- --keep` writes it to `evidence/runs/` instead.

## Demo path: discover, then replay

Terminal 1 — the target app (a deliberately hostile legacy UI: iframe shell, nested
tables, no test ids, ASP.NET-style names):

```bash
npm run fixture                 # http://localhost:8080
```

Terminal 2 — **discover** the read flow with the local model. Published versions are
immutable and `1.0.1` is committed, so first set `"version": "1.0.2"` under
`capability` in `discovery/requests/member.read-account-balance.json`, then:

```bash
npm run discover -- --request discovery/requests/member.read-account-balance.json
```

Each decision and its rationale is printed as it happens; the result is JSON on
stdout (exit 0 `succeeded`, 3 `failed`, 4 `escalated`). The new artifact is written as
a draft to `capabilities/member.read-account-balance/1.0.2.json`, and the run's
evidence to `evidence/runs/<run>/`. Review the artifact (it is a new file in
`git status`, comparable with the committed `1.0.1.json`) before committing it.

**Replay** it — `@1` resolves to the latest `1.x`, and no model is involved:

```bash
npm run replay -- --capability member.read-account-balance@1 --input memberId=10002 --input accountType=Savings
# exit 0: "status": "succeeded", "outputs": { "balance": "3,100.55" }

npm run replay -- --capability member.read-account-balance@1 --input memberId=99999 --input accountType=Savings
# exit 2: "status": "business_outcome", "outcome": "member_not_found"

npm run replay -- --capability member.read-account-balance@1 --input memberId=abc --input accountType=Savings
# exit 3: "status": "failed", "failure": { "stepId": "inputs", "code": "invalid_input", ... }
```

Replay exit codes: 0 `succeeded`, 2 `business_outcome`, 3 `failed`, 4 `escalated`,
1 usage or configuration error. Outputs are returned unmasked on stdout; in the
evidence they are redacted.

## Human handoff

The write flow ends with a risky `Confirm`, which automation never performs. Replay
the committed, model-discovered `member.open-sub-account@1` with a visible browser:

```bash
npm run replay -- --capability member.open-sub-account@1 --input memberId=10002 \
  --input "accountType=Holiday Club" --input nickname=Vacation --input initialDeposit=100.00 --headed
```

Automation fills the form and stops before `click-confirm`. The terminal prints the
intervention request (also written to `intervention.json`) and a `handoff>` prompt:

1. type `take` — you now own the session; the gateway refuses automation actions
2. click **Confirm** in the browser window; the page's `confirm()` dialog is answered
   at the `dialog>` prompt: type `accept`
3. type `resume` — the run re-observes the page and verifies the step's checkpoint
   before continuing (if it does not hold, control comes back to you), then reads the
   new account number: exit 0

`abort` ends the run as `escalated` (`aborted`, exit 4); so do an expired
`HANDOFF_TTL_MS` (`ttl_expired`) and a closed window (`surface_closed`). Without
`--headed` there is no operator surface and the run ends at once as `escalated`
(`no_operator_surface`). What the human did (clicks, navigations, dialog answers,
typed values as `[redacted]`) is recorded as `handoff_*` events with before/after
screenshots.

To rediscover the write flow yourself, bump `capability.version` in
`discovery/requests/member.open-sub-account.json` to `1.0.1` and run
`npm run discover -- --request discovery/requests/member.open-sub-account.json --headed`;
when the model's click on `Confirm` is escalated, do the same `take`, click, `accept`,
`resume`.

## Evidence

[`evidence/README.md`](evidence/README.md) indexes the committed runs: the two genuine
local-model discoveries (read flow, 6 decisions in 27 s; write flow, 13 decisions in
68 s with a handoff), their artifacts, and replays covering success, a business
outcome, a recovered fault, a hard failure, a handoff and an escalation with no
operator. The operator actions in the committed handoffs were performed by a scripted
operator through the real handoff channel; the evidence index explains how.

## What is mocked, and why

| Mocked | Instead | Why |
|---|---|---|
| A bank's back-office app | [`fixture/`](fixture/README.md), a local legacy-style app with seeded synthetic members and injectable faults | no real bank system may be used; the fixture reproduces the hard parts on demand (ADR-004) |
| The operator console | the run's own headed browser window plus the `handoff>` prompt on stdin, on the same machine | the control-transfer model is real; a console that streams the session (CDP screencast) and queues requests is UI work with no new decisions (RFC-005) |
| The operator in committed handoff evidence | a scripted operator using the same prompt and page | a recording has to be reproducible; the steps for a person are above |
| Credential storage | environment variables; sign-in over HTTP, cookie injected into the browser | authentication is a precondition, not a recorded step (ADR-013) |
| Desktop surfaces, per-tenant overlays, drift detection | design only, with the seams in code | out of scope for v1 (RFC-007) |
| The model in `npm run verify` | a scripted reasoner; real calls are opt-in with `npm run test:live` | tests must run offline and deterministically |

## Layout

```text
src/
  models/ logic/        domain types (Zod) and pure rules: policy, checkpoints, classification, redaction, synthesis
  controllers/          discovery, replay, escalation
  adapters/ wire/       external formats <-> domain
  diplomat/             CLI entrypoints and I/O: surface (Playwright), reasoner, session, gateway, store, evidence, escalation
  infrastructure/       config, clock, ids
capabilities/           versioned capability artifacts
discovery/              capability requests and per-app outcome catalogs (discovery input)
evidence/               curated sample runs
fixture/                the target app
scripts/demo.ts         the no-model demo
tests/                  unit, integration (real fixture and browser), live (opt-in, real model)
policy.json             the allowlist
```

## Design docs

- [`REPORT.md`](REPORT.md) — architecture, artifact schema, determinism and error
  handling, heterogeneity and multi-tenant, escalation and handoff, safety, cuts
- [`docs/README.md`](docs/README.md) — RFCs and ADRs behind each decision
