# Evidence

Curated sample runs (ADR-014), one per case. Each folder under `runs/` is one run:
`run.jsonl` (one event per line), `result.json`, and, where the run captured them,
`artifact.json`, `intervention.json`, `screenshots/` and `snapshots/`. Paths inside a
run (`failure.evidence`, `intervention.json`'s `screenshot`) are relative to its folder.

Everything is redacted (RFC-006): the target password never appears; declared-sensitive
inputs and outputs show as `[REDACTED:<sensitivity>]` in every JSON file of the run and,
from the moment each is known (inputs at once, outputs once read), are covered by a solid
box in screenshots. Account numbers keep only their last 4
digits in JSON; in these screenshots they are boxed too, because the fixture's account
numbers contain the declared member ID. Other page data the capability does not declare
(the member's name, balances that were not read) stays visible. All data is synthetic.

**Saved example artifacts:** the `artifact.json` of the two discovery runs is what
discovery wrote, with `"status": "draft"`. After review they were published unchanged
except for `"status": "approved"` as
[`member.read-account-balance@1.0.2`](../capabilities/member.read-account-balance/1.0.2.json)
and [`member.open-sub-account@1.0.1`](../capabilities/member.open-sub-account/1.0.1.json).

## Runs

| Run | What it shows | Result | Req. |
|---|---|---|---|
| [`…21-39-10-424Z-discovery-member.read-account-balance`](runs/2026-09-24T21-39-10-424Z-discovery-member.read-account-balance/) | Genuine discovery with the local model (`qwen3:14b` on Ollama) through `npm run discover -- --request … --version 1.0.2 --headed`: 6 decisions in 31 s, each with its `rationale`, latency and Ollama metadata (`providerMeta`: token counts, durations). A masked screenshot and a snapshot per step. Produced `member.read-account-balance@1.0.2`. | `succeeded` | §3.1, §3.2, §3.5 |
| [`…21-40-05-051Z-replay-member.read-account-balance`](runs/2026-09-24T21-40-05-051Z-replay-member.read-account-balance/) | `npm run replay` of that artifact without the model, member 10002, whose Savings account is not the first row: `read-balance` resolves by its `table_cell` candidate (`target_resolved` events). | `succeeded` | §3.3 |
| [`…21-40-08-036Z-replay-member.read-account-balance`](runs/2026-09-24T21-40-08-036Z-replay-member.read-account-balance/) | Same, member 99999: the page shows "No records found.", a declared business outcome. | `business_outcome` `member_not_found` (exit 2) | §3.3 |
| [`…22-06-20-048Z-replay-member.read-account-balance`](runs/2026-09-24T22-06-20-048Z-replay-member.read-account-balance/) | Member 10009, restricted: the search results say "You are not authorized to view this record." instead of listing the member (permission denied), a declared business outcome, not a failure. | `business_outcome` `member_restricted` (exit 2) | §3.3 |
| [`…22-06-20-862Z-replay-member.read-account-balance`](runs/2026-09-24T22-06-20-862Z-replay-member.read-account-balance/) | Injected `interstitial` fault on the first step: the checkpoint fails, the page matches the declared recoverable outcome, its recovery clicks Continue and the step is retried. | `succeeded`, `recoveries[0].outcomeId = interstitial` | §3.3 |
| [`…22-06-22-371Z-replay-member.read-account-balance`](runs/2026-09-24T22-06-22-371Z-replay-member.read-account-balance/) | Injected `unexpected_dialog` fault: a native alert ("Your password expires in 3 days.") the artifact does not expect is dismissed, recorded as a recovery, and the run goes on. | `succeeded`, `recoveries[0].condition = unexpected_dialog` | §3.3 |
| [`…22-06-23-421Z-replay-member.read-account-balance`](runs/2026-09-24T22-06-23-421Z-replay-member.read-account-balance/) | Injected `server_error` fault: HTTP 500 on the first step's navigation, a hard failure with `stepId`, `code`, `expected`, `observed`, and the failure screenshot and snapshot. | `failed` `server_error` (exit 3) | §3.3, §3.5 |
| [`…21-59-10-531Z-discovery-member.open-sub-account`](runs/2026-09-24T21-59-10-531Z-discovery-member.open-sub-account/) | Genuine discovery of the write flow with the local model: 13 decisions in 45 s, from the menu through the member lookup and the sub-account form to the review. The model's click on `Confirm` got `requires_human` from the gateway (`step-11`); the run handed the same browser session over (`intervention.json`), the operator clicked `Confirm` and accepted the page's `confirm()` dialog, and after `resume` the model, told what the person did, read the new account number and finished. The model's premature `Continue` (before the deposit was filled) is in the log but not in the artifact: the application rejected it. Produced `member.open-sub-account@1.0.1`, whose only `risky` step is that `Confirm`. | `succeeded`, one intervention | §3.1, §3.2, §3.4, §3.6 |
| [`…21-59-55-274Z-replay-member.open-sub-account`](runs/2026-09-24T21-59-55-274Z-replay-member.open-sub-account/) | Replay of that artifact, member 10002, `Holiday Club`, `Vacation`, `100.00`: automation filled the form, stopped before the risky `click-confirm` and handed the session over; the operator confirmed (click, dialog `accept`), the step's checkpoint held (`performedBy: human`) and the run read the new account number. | `succeeded`, one intervention | §3.3, §3.6 |
| [`…22-00-55-961Z-replay-member.open-sub-account`](runs/2026-09-24T22-00-55-961Z-replay-member.open-sub-account/) | `npm run replay` of the write artifact with `initialDeposit=10.00`: the application rejects the deposit at `click-continue`, before any risky step. | `business_outcome` `invalid_initial_deposit` (exit 2) | §3.3 |
| [`…22-06-23-884Z-replay-member.close-account`](runs/2026-09-24T22-06-23-884Z-replay-member.close-account/) | Replay of the hand-written `member.close-account@1.0.0`: its last step is `risky`, so automation stops before acting and hands the session over; the operator takes control, clicks `Close Account`, resumes, and the checkpoint is verified on the page the human left (`handoff_*` events, before/after screenshots). | `succeeded`, one intervention | §3.4, §3.6 |
| [`…22-06-25-059Z-replay-member.close-account`](runs/2026-09-24T22-06-25-059Z-replay-member.close-account/) | Same capability with no operator window (no `--headed`): the intervention request is still written, and the run ends at once. | `escalated` `no_operator_surface` (exit 4) | §3.6 |

The six `22-06-*` runs come from `npm run demo -- --keep` (scenarios 3–8; scenarios
1–2 match the two `npm run replay` runs above). The demo starts its own fixture on a
free port, hence the different ports in the URLs.

## Where to look

- **Why the agent did something:** `decision` events in the discovery `run.jsonl`
  (`verb`, `target`, `rationale`, `latencyMs`, `reasoner`, `providerMeta`).
- **Guardrails:** every action is preceded by a `policy` event; the write-flow
  discovery has `"decision":"requires_human"` at `step-11`.
- **Redaction:** the declared member ids, deposits, read balances and new account
  numbers appear as `[REDACTED:internal]` / `[REDACTED:financial]` in events,
  snapshots, URLs and `result.json`, and as boxes in screenshots taken once the value is
  known; a value typed by a human during a handoff is captured as `[redacted]`. The
  sign-in page is never photographed, and none of these runs reached it, because sign-in
  happens over HTTP before the browser opens (ADR-013).
- **Handoff:** `intervention.json` plus the `handoff_requested`, `handoff_taken`,
  `handoff_human_action`, `handoff_resumed` events and the
  `handoff-<interventionId>-before|after` screenshots and snapshots.

## About the operator in these recordings

The model decisions are genuine; **every operator action here was performed by a
scripted operator** (`scripts/lib/scripted-operator.ts`, shared with the tests) through
the same handoff channel a person uses: it typed `take` and `resume` at the real CLI
broker's `handoff>` prompt, answered `accept` at its `dialog>` prompt, and clicked in the
run's own browser page. The write-flow recordings come from
`tests/live/discovery-write.live.test.ts`
(`RUN_LIVE_MODEL=1 npx vitest run tests/live/discovery-write.live.test.ts --reporter=default`),
which runs the same composition root, controllers, broker, gateway and Playwright session
as `npm run discover` in one process, with the fixture on a free port and operator id
`test-operator`: a script cannot reach the browser of a separate `npm run discover`
process. No recording with a person at the keyboard is committed; to make one, follow
"Human handoff" in the [README](../README.md#human-handoff).
