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
discover --goal "look up member 10001 and read their savings balance" \
         --target http://localhost:8080/ \
         --capability member.read-account-balance \
         --reasoner local
```

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

Stateless per call. The controller owns the history. Adapters: local (Ollama) and
hosted (OpenAI-compatible), selected per run.

## Loop

1. **Observe** — the surface driver returns the accessibility tree per frame,
   current URL, and dialog state (ADR-005). Each addressable element gets a short
   ref (`e12`) valid **only for this observation**. Sensitive values are redacted
   before the reasoner sees them.
2. **Decide** — the controller builds this step's JSON Schema from the domain
   `Action` schema, with `target` narrowed to the observation's refs, and calls
   the reasoner. The answer is one action:

   ```json
   { "verb": "fill", "target": "e12", "argument": "10001", "rationale": "Member ID field on the lookup form" }
   ```

   Verbs: `click`, `fill`, `select`, `press`, `navigate`, `read`, `finish`,
   `request_help`.
3. **Ground** — the controller re-checks that the ref belongs to the current
   observation. A mismatch is rejected without touching the surface.
4. **Gate** — the action gateway evaluates policy (ADR-011).
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
| No progress 3 times in a row, or repeated denials | Escalate |
| Model answers `request_help` | Escalate |

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
- The observation after each action becomes that step's checkpoint
- Values that match goal parameters are replaced by `{{inputs.*}}`
- Values captured with `read` become typed outputs
- Business outcomes and recoverable conditions come from a per-app catalog (the
  fixture's known result texts), not guessed
- `provenance` records reasoner adapter, model, and discovery run id

The artifact is written as a draft; a human reviews it before it is used.

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
