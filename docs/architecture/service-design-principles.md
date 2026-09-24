# Service Design Principles

## Purpose

This document defines the **architectural style** adopted by this system.

The style is inspired by Hexagonal and Clean Architecture, but follows a more
opinionated and explicit structure — the **Diplomat** style — focused on:

- Clear separation of responsibilities
- A strict boundary between business logic and infrastructure
- High testability without a live browser or a live model
- Predictable data flow
- **Structural**, rather than procedural, guarantees about which code paths may
  reach which external systems

This document describes **roles and responsibilities**, not implementation details.

---

## Core Architectural Idea

The system is structured around two clearly separated zones:

- **Domain (Core)** — meaning and decision-making
- **Boundary (External)** — interaction with the outside world

The Domain is **protected and pure**. All side effects are **isolated in the
Boundary**. Dependencies always point **towards the Domain**.

### Why this matters here specifically

This system has two execution paths with fundamentally different guarantees:

| Path | Guarantee |
|---|---|
| **Discovery** | May call a language model. Non-deterministic by design. Runs once. |
| **Replay** | Must never call a language model for a decision. Deterministic. Runs continuously in production. |

Under this architecture, that difference is not a runtime flag or a code-review
promise. The reasoning model is reachable only through a Boundary component, and
the replay controller does not depend on it. **Determinism becomes a property of
the dependency graph** — auditable by reading imports, not by trusting a comment.

---

## Domain Layer (Core)

### Model

**What it represents** — the internal data contracts of the domain.

Examples in this system: the capability artifact and its steps, locator
descriptors, observations of a surface, agent decisions, execution results,
intervention requests.

**Rules**
- No behavior
- No dependencies
- Strict and explicit
- Independent from transport, storage, or surface technology

> Models express *what the system understands*, not how data arrives.

---

### Logic

**What it represents** — pure rules.

Examples in this system: synthesizing a capability artifact from a discovery
trace, evaluating whether a checkpoint holds, classifying an observed state into
a business outcome or a failure, deciding whether an action is permitted by
policy, computing what must be redacted.

**Rules**
- Knows only Models
- No side effects
- Deterministic and referentially transparent

> Logic answers *"given this state, what is the correct outcome?"*

Note that the most safety-critical decisions in this system — is this action
allowed, did we actually reach the expected state, is this a legitimate business
result or a genuine failure — live here, where they are testable without a
browser, without a network, and without a model.

---

### Controller

**What it represents** — orchestration of one use case.

Examples in this system: the discovery controller running the observe → decide →
act loop; the replay controller executing a capability; the escalation controller
transferring control to a human and resuming.

**Rules**
- Knows Models, Logic, and Diplomats
- Coordinates flows; performs no computation of its own
- Delegates every side effect to the Boundary

> Controllers coordinate *flows*; Logic performs *reasoning*.

---

## Boundary Layer (External)

### Wire

**What it represents** — data contracts at the system boundary.

Examples in this system: the serialized artifact file on disk, model request and
response payloads, CLI arguments, evidence log records.

**Rules**
- Pure data definitions
- No dependencies
- Not reused inside the Domain
- Loose on the way in, strict on the way out

> Wire represents *how the world speaks to the system*.

A specific consequence here: an artifact read from disk is **untrusted input**. It
is a Wire shape until it has been validated and adapted into a Model.

---

### Adapter

**What it represents** — translation between Wire and Model.

Examples in this system: serialized artifact ↔ capability model; model response
→ agent decision; raw surface snapshot → observation.

**Rules**
- Knows Wire and Model
- No business logic
- Side-effect free

> Adapters protect the Domain from external complexity.

---

### Diplomat

**What it represents** — orchestration of external interactions. Diplomats own
every side effect.

Examples in this system: the surface driver that observes and acts on a live
application; the reasoner client that calls a language model; the artifact store;
the evidence recorder; the escalation broker.

**Rules**
- Knows Wire, Adapter, Controller, Model, and Logic
- Contains no business rules
- Owns all I/O

> Diplomats speak to the world on behalf of the Domain.

Two Diplomats carry unusual architectural weight here:

**The surface driver** is the seam for heterogeneity. The Domain describes *what*
to do to a control; the driver knows *how* to do it on a given surface. Extending
the system from a web application to a desktop application is a new Diplomat
behind the same port, not a change to the artifact schema or the replay engine.

**The reasoner client** is the seam for determinism. It exists only on the
discovery path.

---

## Dependency Rules (Strict)

| Component | Can Depend On |
|---|---|
| Model | — |
| Logic | Model |
| Controller | Model, Logic, Diplomat |
| Wire | — |
| Adapter | Wire, Model |
| Diplomat | Wire, Adapter, Controller, Model, Logic |

Any violation of these rules is considered **architectural drift**.

Diplomats may depend on Model and Logic because ports are typed with models, the
action gateway calls the pure policy logic, and the evidence recorder calls the
pure redaction logic.

### Additional rule for this system

> The replay controller must not depend, directly or transitively, on the reasoner
> Diplomat.

This is the structural expression of "no model in the decision loop". The check
also covers the replay CLI, the replay composition, and the demo script.

Further rules:

- Controllers reach Diplomats only through their `port.ts` types; concrete
  implementations are wired in one composition root (`src/diplomat/composition/`)
  shared by both CLIs, the test harnesses, and the demo script.
- `infrastructure/` imports no other layer.
- Models and Logic import no Node built-ins and no npm package other than Zod.
- Only the surface Diplomat (`src/diplomat/surface/`) imports Playwright.

These rules are checked by dependency-cruiser (`npm run depcruise`, part of
`npm run verify`).

---

## Data Flow

```text
External Input
  → Wire (in)
    → Adapter
      → Model
        → Logic
      → Model
    → Adapter
  → Wire (out)
→ External Output
```

Data is validated and transformed **at the boundaries**, never inside the Domain.

---

## Error Handling Principles

- Domain outcomes are explicit and meaningful
- Technical errors are handled in the Boundary
- Validation happens as early as possible
- A legitimate business result is never represented as a technical failure

The last point is a first-class concern in this system rather than a style
preference: a caller that receives only "it failed" cannot make a business
decision.

---

## Testing Strategy

| Layer | Test type | What is verified |
|---|---|---|
| Logic | Unit | Rules, classification, policy — no I/O |
| Adapter | Unit | Wire ↔ Model translation, including malformed input |
| Controller | Integration with fakes | Orchestration order and branching |
| Diplomat | Integration | Real I/O against the local target or a stub |

Because the Domain has no infrastructure dependencies, the safety-critical rules
are tested without a browser and without a model.

---

## Common Pitfalls

Avoid:
- Business rules in Adapters or Diplomats
- Side effects inside Logic
- Surface-specific concerns (selectors, DOM, coordinates) in Models
- Leaking external naming into the Domain
- Direct infrastructure access from Controllers

---

## Directory Structure

```text
src/
  models/
  logic/
  controllers/
  adapters/
  wire/
    in/
    out/
  diplomat/
    cli/ composition/ escalation/ evidence/ gateway/
    reasoner/ session/ store/ surface/
  infrastructure/
```

`infrastructure/` holds cross-cutting technical concerns — clock, configuration,
error helpers, ids, JSON file reading — usable by any layer.

---

## Related

- ADR-001 — Diplomat Architecture as Service Structure
- ADR-002 — TypeScript on Node as Language and Runtime
- ADR-003 — Single Process, CLI-First Composition
- RFC-001 — System Scope & Component Landscape
