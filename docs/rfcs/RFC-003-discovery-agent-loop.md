# Discovery: LLM-Driven Observe / Decide / Act (v1)

---

| Field | Value |
|---|---|
| **RFC** | RFC-003 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Defines the discovery loop that accomplishes a goal on a live surface with a language model and turns the successful run into a capability artifact. |

---

## Context

Discovery is the only phase where a model is used. It runs once per capability,
against the live surface, and its output is an artifact — not the transcript.

## Input

```bash
discover --goal "look up member 10001 and read their savings balance" \
         --target http://localhost:8080/ \
         --capability member.read-account-balance
```

## Loop

1. **Observe** — surface driver returns the accessibility tree per frame, current
   URL, and dialog state (ADR-005). Sensitive values are redacted before the model
   sees them.
2. **Decide** — reasoner receives goal, observation, and a compact history; returns
   exactly one tool call with a rationale (ADR-010).
3. **Gate** — action gateway evaluates policy (ADR-011). A denial becomes the next
   observation.
4. **Act** — driver executes; the action, the element it resolved, and the
   resulting observation are appended to the run trace.
5. Repeat until `finish` or a stopping condition.

## Stopping conditions

| Condition | Result |
|---|---|
| Model calls `finish` and the goal check holds | Success → synthesize artifact |
| Step budget exceeded (default 25) | Failure |
| Wall-clock timeout (default 5 min) | Failure |
| Dead end: same observation 3 times in a row, or repeated denials | Escalate |
| Model calls `request_help` | Escalate |

## From trace to artifact

The **artifact synthesizer** (pure Logic) turns the trace into an artifact:

- Each executed action becomes a step; each resolved element becomes a target with
  a candidate chain built from what was observed (role/name, label, attributes)
- The observation after each action becomes that step's checkpoint
- Values that match goal parameters are replaced by `{{inputs.*}}`
- Values the model extracted with `read` become typed outputs
- Business outcomes and recoverable conditions are added from a per-app catalog
  (the fixture's known result texts), not guessed

The artifact is written as a draft; a human reviews it before it is used.

## Non-Goals

- Learning multiple paths or branches in one run
- Automatic discovery of business outcomes the run never encountered

## Related

- ADR-005 — Accessibility-Tree-First Perception Model
- ADR-006 — Playwright as the Computer-Use Driver
- ADR-010 — LLM Provider and Structured Tool Calling
- ADR-011 — Guardrail Enforcement at a Single Action Gateway
- RFC-002 — Capability Artifact: Schema & Contract
