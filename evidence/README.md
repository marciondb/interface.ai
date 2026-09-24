# Evidence

Curated sample runs (ADR-014). Each folder under `runs/` is one run: `run.jsonl`
(one event per line), `result.json`, and, where the run captured them, `artifact.json`,
`screenshots/` and `snapshots/`. Everything is redacted before it is written (RFC-006):
the target password never appears, and declared-sensitive values show as
`[REDACTED:<sensitivity>]` from the moment they are known.

| Run | What it shows |
|---|---|
| [`2026-09-24T17-21-04-747Z-discovery-member.read-account-balance`](runs/2026-09-24T17-21-04-747Z-discovery-member.read-account-balance/) | Genuine discovery with the local model (`qwen3:14b` on Ollama) against the fixture: 6 decisions, each with its rationale, in 27 s. Produced [`member.read-account-balance@1.0.1`](../capabilities/member.read-account-balance/1.0.1.json) (`artifact.json` is the same file). |
| [`2026-09-24T17-21-48-771Z-replay-member.read-account-balance`](runs/2026-09-24T17-21-48-771Z-replay-member.read-account-balance/) | Replay of the discovered artifact without the model, member 10001: `succeeded`. |
| [`2026-09-24T17-21-50-647Z-replay-member.read-account-balance`](runs/2026-09-24T17-21-50-647Z-replay-member.read-account-balance/) | Same, member 10002 (Savings is not the first account): `succeeded`. |
| [`2026-09-24T17-21-52-189Z-replay-member.read-account-balance`](runs/2026-09-24T17-21-52-189Z-replay-member.read-account-balance/) | Same, member 99999: `business_outcome` `member_not_found`. |
