# Local Reasoner with Schema-Constrained Output

| Field | Value |
|---|---|
| **ADR** | ADR-015 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Supersedes** | ADR-010 — LLM Provider and Structured Tool Calling |
| **Description** | Discovery runs against a local model served by Ollama by default, with generation constrained to a per-step JSON Schema so the model can only produce a well-formed action aimed at an element that exists. A hosted, OpenAI-compatible model is an explicit alternative behind the same port. |

---

## Context

ADR-010 chose a hosted frontier model through tool calling. Two things argue
against making that the default:

- **Data egress.** Observations of a back-office screen are regulated data. Even
  redacted, sending them to a third party is a compliance question before it is a
  technical one. A local model keeps every observation on the machine.
- **Running discovery should not require an account.** With a hosted default,
  nobody can reproduce a discovery run without a paid key.

A local model is smaller and weaker. The design has to compensate by making the
decision the model faces as small and as constrained as possible.

## Decision

**Default reasoner: a local model served by Ollama.**

| Setting | Value |
|---|---|
| Endpoint | Ollama native chat API, `http://localhost:11434` by default, configurable via `OLLAMA_BASE_URL` (must be loopback) |
| Model | `qwen3:14b` by default, configurable via `REASONER_MODEL` |
| Output | `format` set to the step's JSON Schema — constrained decoding, not parsing |
| Sampling | `temperature: 0`, `think: false`, `stream: false` |

**Why 14B.** On the first live check (the Member Lookup screen of the fixture,
goal "look up member 10001…"), `qwen3:8b` gave the same wrong answer on all three
runs: it clicked the menu link for the screen it was already on. `qwen3:14b`, same
family and the same `format`/`think` support, filled the member ID correctly on
all three, at about 2.6 s per warm call on an Apple M4 Pro with 24 GB. The 8B
model can still be selected through `REASONER_MODEL` on machines with less
memory, at lower accuracy.

**Constrained output, built per step.** The schema is generated from the flat domain
`ModelStep` schema for each observation, with `target` narrowed to an `enum` of the
element references present in that observation. A reference to an element that
does not exist cannot be generated. An adapter still validates every response
before it becomes a domain decision.

**Stateless calls.** Each call receives the goal, the current observation, and a
short note when the previous action had no effect or was denied. The discovery
controller owns the history; the reasoner holds none, so adapters are swappable
mid-run.

**Bounded retries.** Transport failures and invalid output have separate, small
retry budgets. Both end in a typed error; the reasoner never returns a
best-effort action.

**Hosted alternative.** A second adapter speaks the OpenAI-compatible chat API
with `response_format` set to the same JSON Schema. It covers hosted providers
and any local server exposing that API; its endpoint (`HOSTED_BASE_URL`) must use
https unless it is loopback. Selection is explicit per run
(`--reasoner local|hosted`); there is no automatic failover.

**Provenance.** Adapter and model are recorded in the artifact's `provenance`.
Every decision event in the run's evidence also records them, with the call's
latency and, when the provider reports it, its metadata (`providerMeta`).

## Consequences

**Positive**
- Observations never leave the machine on the default path
- Discovery runs with no key and no account
- Constrained decoding is a stronger guarantee than tool calling: invalid shapes
  and invented targets are unrepresentable, not just rejected afterwards
- The grounded-reference schema doubles as a guardrail: the model cannot aim at
  anything the page does not show

**Negative**
- Slower per step than a hosted model, especially on a laptop
- Smaller models navigate multi-frame pages less reliably; a run may exhaust its
  budget where a frontier model would succeed
- Requires installing Ollama and pulling a model of about 9 GB, with roughly 10 GB
  of free memory to run it

**Mitigation.** Compact observations (ADR-005), the reference `enum`, the
no-progress note, and the step budget exist largely to make a small model
viable. If a local run cannot complete a flow, the hosted adapter is the
documented fallback, and the evidence records which one produced the artifact.

## Alternatives

- **Hosted model as default (ADR-010)** — superseded: data egress and a mandatory
  key for the one phase that must be reproducible.
- **Tool calling against the local model** — rejected: tool-call support varies by
  model and server; schema-constrained output works uniformly and is enforced by
  the server during generation.
- **Automatic failover from local to hosted** — rejected: it would silently send
  data off the machine and hide a capability that only works on one model.
- **llama.cpp or another local server directly** — not excluded: any server
  exposing the OpenAI-compatible API works through the second adapter. Ollama is
  the default because it is the simplest install with native schema support.

## Related

- ADR-005 — Accessibility-Tree-First Perception Model
- ADR-010 — LLM Provider and Structured Tool Calling (superseded)
- ADR-011 — Guardrail Enforcement at a Single Action Gateway
- RFC-003 — Discovery
- RFC-006 — Safety, Guardrails & Regulated Data Handling
