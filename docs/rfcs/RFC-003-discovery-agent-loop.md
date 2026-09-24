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
discover --request discovery/requests/<id>.json [--version x.y.z] [--reasoner local|hosted] [--target <url>] [--headed]
discover --goal <text> --capability <id> [--input name=example[:sensitivity]]... --output name[:sensitivity]... [--outcome <catalog id>]... [--version x.y.z] [...]
```

The `--goal` form builds the same request from flags (string fields, every
catalog outcome unless `--outcome` is given, sensitivity `internal` unless
suffixed). The capability request file declares:

- the capability identity (`id`, `version`, `description`, `app`)
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
type Reasoner = {
  adapter: 'ollama' | 'openai-compatible'
  model: string
  propose(input: {
    goal: string
    observation: Observation      // redacted, with observation-scoped element refs
    validRefs: readonly string[]  // refs present in this observation
    feedback?: string             // why the previous action did not advance the run
  }): Promise<Proposal>           // { decision: AgentDecision, meta?: ProviderMeta }; validated, or throws — never best-effort
}
```

Stateless per call. The controller owns the history; the only part it passes on is
in the goal, which lists the declared outputs already read and what a person did
during a handoff, so the model knows when to answer `finish` and what not to
repeat. Adapters: local (Ollama, default model `qwen3:14b`, `think: false`) and
hosted (OpenAI-compatible, strict `json_schema`), selected per run; both call the
model at temperature 0. The reasoner does not redact; it receives an observation
that is already redacted. Each decision is logged with the provider's metadata
(`providerMeta`: model, token counts, durations) when the provider returns it.

## Loop

1. **Observe** — the surface driver returns the accessibility tree per frame,
   current URL, and dialog state (ADR-005). Each addressable element gets a short
   ref (`e12`) valid **only for this observation**. The controller redacts the
   observation right after `observe()` and before `propose`, so the model and
   the trace see the same redacted observation (RFC-006): secrets and every
   sensitive output read so far are masked; declared inputs stay visible, since
   the model has to type them.
2. **Decide** — the controller calls the reasoner, which builds this step's JSON
   Schema from the flat `ModelStep` schema with `target` narrowed to `validRefs`.
   The answer is one flat object:

   ```json
   { "verb": "fill", "target": "e12", "argument": "10001", "rationale": "Member ID field on the lookup form" }
   ```

   Verbs: `click`, `fill`, `select`, `press`, `navigate`, `read`, `finish`,
   `request_help`. `navigate`, `finish` and `request_help` take no target; every
   other verb requires one. The adapter checks these rules and turns the answer
   into an `AgentDecision`:

   ```ts
   type AgentDecision =
     | { kind: 'act'; action: PageAction; rationale: string }          // click, fill, select, press, navigate
     | { kind: 'read'; action: { kind: 'read'; ref: Ref }; output: string; rationale: string }
     | { kind: 'finish'; summary: string | null; rationale: string }
     | { kind: 'request_help'; message: string; rationale: string }
   ```

   The surface only ever receives the `SurfaceAction` (`click{ref}`,
   `fill{ref,value}`, `select{ref,option}`, `press{ref,key}`, `navigate{url}`,
   `read{ref}`).
3. **Ground** — the controller re-checks that the ref belongs to the current
   observation. A mismatch is rejected without touching the surface.
4. **Gate** — the action gateway evaluates policy (ADR-011). A `requires_human`
   answer triggers the human handoff (RFC-005). After resume, if the page
   changed, the blocked action the human performed is recorded as a step with
   `risk: risky`; if unchanged, the human declined and the model gets feedback.
   Stalls and `request_help` hand over the same way.
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
- **Stall counter:** a single counter of turns that did not advance the run
  (unchanged page, rejected ref or output name, gateway denial, failed action,
  `finish` before the goal holds, a declined handoff); reset whenever a step makes
  progress.

## Prompt

One generic system prompt: what each verb does, answer with one JSON object, target
only listed refs, use `read` to capture requested values and `finish` when the goal
is met, never repeat what the goal says a person already did. The prompt names no
app, flow, or domain; the same prompt must discover both the read flow and the
write flow.

## From trace to artifact

The **artifact synthesizer** (pure Logic) turns the trace into an artifact:

- Each executed action becomes a step. Refs are ephemeral and never persisted;
  each resolved element becomes a target with a candidate chain built from what
  was observed (role/name, label, attributes) and `notes` explaining why the
  chain is ordered as it is
- An element in a table row that contains an input value gets a `table_cell`
  structural candidate
- A target the model reads never uses role/name — its name is the data itself —
  nor a label that is record data; a value displayed next to its label cell
  ("New Account Number:") is located by that label
- The observation after each action becomes that step's checkpoint
- An action after which the application newly shows one of the request's
  business outcomes (e.g. a validation error on a premature submit) is a detour
  and becomes no step
- A handoff in which the human made a single click on an element of the screen
  they were handed, accepting any confirmation dialog it opened, becomes a
  `risky` click step, checked by what it revealed; any other human activity
  (typing, a dismissed dialog, several clicks) makes synthesis fail, with the
  actions kept in the evidence
- Values equal to an input's `example` are replaced by `{{inputs.*}}`
- Values captured with `read` become typed outputs
- Business outcomes and recoverable conditions come from the per-app catalog
  ids listed in the request, not guessed
- `provenance` records reasoner adapter, model, and discovery run id

The artifact is written as a new version file with `status: "draft"`. A reviewer
sets it to `approved` before committing it; until then replay skips it unless run
with `--allow-draft`. A version that already exists is never overwritten: the run
fails with `artifact_exists` before opening the surface.

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
