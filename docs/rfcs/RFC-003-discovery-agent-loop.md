# Discovery: LLM-Driven Observe / Decide / Act (v1)

---

| Field | Value |
|---|---|
| **RFC** | RFC-003 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Defines the discovery loop that accomplishes a goal on a live surface with a language model — local by default — and turns the successful run into a capability artifact. |

---

## Context

Discovery is the only phase where a model is used. It runs once per capability,
against the live surface, and its output is an artifact — not the transcript.

The default reasoner is a local model (ADR-015). Most of this loop's design exists
to make a small model viable: the decision it faces each turn is kept small, and
the shape of its answer is constrained during generation.

## Input

```bash
discover --request discovery/requests/<id>.json --reasoner local|hosted [--target <url>] [--headed]
```

The capability request file declares:

- a goal template with `{{param}}` placeholders
  ("look up member {{memberId}} and read their {{accountType}} balance")
- typed inputs, each with an `example` value used during the run
- the declared outputs
- the ids of the outcomes that apply, taken from a per-app catalog
  (`discovery/catalogs/<app>.json`)

Any observed value equal to an input's `example` becomes `{{inputs.x}}` in the
artifact, so parameterization is deterministic rather than guessed.

## Reasoner port

```ts
interface Reasoner {
  propose(input: {
    goal: string
    observation: Observation      // redacted, with observation-scoped element refs
    validRefs: string[]           // refs present in this observation
    feedback?: StepFeedback       // why the previous action did not advance the run
  }): Promise<AgentDecision>      // validated, or throws — never best-effort
}
```

Stateless per call. The controller owns the history; the only part it passes on is
in the goal, which lists the declared outputs already read, so the model knows when
to answer `finish`. Adapters: local (Ollama) and
hosted (OpenAI-compatible), selected per run. The reasoner does not redact; it
receives an observation that is already redacted.

## Loop

1. **Observe** — the surface driver returns the accessibility tree per frame,
   current URL, and dialog state (ADR-005). Each addressable element gets a short
   ref (`e12`) valid **only for this observation**. The controller redacts the
   observation right after `observe()` and before `propose`, so the model and
   the trace see the same redacted observation (RFC-006).
2. **Decide** — the controller calls the reasoner, which builds this step's JSON
   Schema from the domain `Action` schema with `target` narrowed to `validRefs`.
   The answer is one action:

   ```json
   { "verb": "fill", "target": "e12", "argument": "10001", "rationale": "Member ID field on the lookup form" }
   ```

   Verbs: `click`, `fill`, `select`, `press`, `navigate`, `read`, `finish`,
   `request_help`.
3. **Ground** — the controller re-checks that the ref belongs to the current
   observation. A mismatch is rejected without touching the surface.
4. **Gate** — the action gateway evaluates policy (ADR-011). A `requires_human`
   answer triggers the human handoff (RFC-005). After resume, if the page
   changed, the blocked action the human performed is recorded as a step with
   `risk: risky`; if unchanged, the human declined and the model gets feedback.
5. **Act** — the driver executes; the action, the resolved element, and the new
   observation are appended to the run trace.
6. **Progress check** — if the new observation is unchanged, the step made no
   progress.

A rejection at 3 or 4, or no progress at 6, produces a one-line `feedback` for the
next call ("your previous `click` on `e7` changed nothing"). Without it, a
stateless model shown the same screen answers the same way again. Feedback is
cleared as soon as a step makes progress.

If an observation has no addressable elements, the model is not called.

## Stopping conditions

| Condition | Result |
|---|---|
| Model answers `finish` and the goal check holds | Success → synthesize artifact |
| Step budget exceeded (default 25) | Failure |
| Wall-clock timeout (default 10 min — local models are slow) | Failure |
| Reasoner exhausts its retry budgets | Failure |
| Stall counter reaches 3 | Escalate |
| Model answers `request_help` | Escalate |

- **Goal check:** every declared output has been captured with `read`.
- **Stall counter:** a single counter summing unchanged-page steps, rejected refs,
  and gateway denials; reset whenever a step makes progress.

## Prompt

One generic system prompt: what each verb does, answer with one JSON object, target
only listed refs, use `read` to capture requested values and `finish` when the goal
is met. The prompt names no app, flow, or domain; the same prompt must discover
both the read flow and the write flow.

## From trace to artifact

The **artifact synthesizer** (pure Logic) turns the trace into an artifact:

- Each executed action becomes a step. Refs are ephemeral and never persisted;
  each resolved element becomes a target with a candidate chain built from what
  was observed (role/name, label, attributes)
- An element in a table row that contains an input value gets a `table_cell`
  structural candidate
- A target the model reads never uses role/name — its name is the data itself
- The observation after each action becomes that step's checkpoint
- Values equal to an input's `example` are replaced by `{{inputs.*}}`
- Values captured with `read` become typed outputs
- Business outcomes and recoverable conditions come from the per-app catalog
  ids listed in the request, not guessed
- `provenance` records reasoner adapter, model, and discovery run id

The artifact is written as a draft: a new version file, reviewed in the diff
before it is committed. There is no status field.

## Non-Goals

- Learning multiple paths or branches in one run
- Automatic discovery of business outcomes the run never encountered
- Automatic failover between reasoners

## Related

- ADR-005 — Accessibility-Tree-First Perception Model
- ADR-006 — Playwright as the Computer-Use Driver
- ADR-011 — Guardrail Enforcement at a Single Action Gateway
- ADR-015 — Local Reasoner with Schema-Constrained Output
- RFC-002 — Capability Artifact: Schema & Contract
