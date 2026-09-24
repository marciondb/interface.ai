# Diplomat Architecture as Service Structure

| Field | Value |
|---|---|
| **ADR** | ADR-001 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-08-19 |
| **Status** | ACCEPTED |
| **Description** | This ADR documents the decision to structure the system using the Diplomat style — a strict, explicit separation between a pure Domain and a side-effecting Boundary — chosen primarily because it turns the system's central guarantee, "no language model in the replay decision path", into a property of the dependency graph. |

---

## Context

The system has two execution paths over the same target application:

- **Discovery** uses a language model to work out how to accomplish a goal. It is
  expensive, slow, and non-deterministic. It runs once.
- **Replay** re-executes the recorded flow with no model involved in any decision.
  It is cheap, fast, and deterministic. It runs continuously.

The value proposition depends entirely on the second path being genuinely
deterministic. If a model can be consulted mid-replay — even as a fallback, even
rarely — the guarantee is gone, and with it the reason a regulated institution
would accept the system.

The system also talks to several external things: a live browser, a model
provider, the filesystem, and a human operator. Each is a source of failure,
latency, and non-determinism.

Two structural questions follow:

1. How do we make "replay never reasons" **verifiable** rather than asserted?
2. How do we keep the rules that matter — is this action allowed, did we reach the
   expected state, is this a business outcome or a failure — testable without a
   browser and without a model?

---

## Decision

The system adopts the **Diplomat architecture**, as specified in
[Service Design Principles](../architecture/service-design-principles.md).

Two zones, with dependencies pointing inward:

- **Domain (Core)** — `models/`, `logic/`, `controllers/`
- **Boundary (External)** — `wire/`, `adapters/`, `diplomat/`

Every external interaction is a Diplomat. In particular, **the language model is a
Diplomat**, on equal footing with the browser driver and the filesystem — not an
ambient capability that any layer can reach for.

One rule is added on top of the standard dependency table:

> The replay controller must not depend, directly or transitively, on the reasoner
> Diplomat.

Because the reasoner is reachable only through an explicit dependency, this rule
is checkable by reading the import graph. Determinism stops being a promise and
becomes a structural fact.

---

## Consequences

### Positive

- **The core guarantee is auditable.** A reviewer can confirm that replay cannot
  reach a model without reading the replay logic — only its dependencies.
- **Safety-critical rules are pure.** Guardrail policy evaluation, checkpoint
  evaluation, and outcome classification live in `logic/`, tested with plain
  values and no infrastructure.
- **Surface heterogeneity has an obvious home.** Supporting a different kind of
  application means writing another Diplomat behind the same port. The artifact
  schema, the replay engine, and the domain rules are untouched.
- **Failure is contained.** Browser flakiness, model timeouts, and filesystem
  errors are all Boundary concerns and cannot leak semantics into the Domain.
- **Consistent shape.** Every capability added later lands in a predictable place.

### Negative

- **More files than the problem strictly requires.** A small feature touches a
  model, a logic function, a controller, an adapter, and a diplomat.
- **Translation boilerplate.** Wire and Model shapes are often similar, and
  keeping them separate costs real code.
- **Indirection tax on reading.** Following one request end to end means opening
  several files.

These costs are accepted. The alternative — a flatter structure — makes the
system's headline guarantee something a reader has to take on faith.

### Enforcement

The dependency rules are checked by dependency-cruiser (`.dependency-cruiser.cjs`,
`npm run depcruise`) as part of `npm run verify`. This includes the rule that
matters most — the replay controller, the replay CLI, the replay composition, and
the demo script cannot reach the reasoner Diplomat, directly or transitively — the
rule that controllers reach Diplomats only through their `port.ts` types, and the
rule that only the surface Diplomat imports Playwright.

---

## Alternatives

### Layered service / repository structure

Controllers, services, repositories — the conventional arrangement.

**Rejected because** it does not force purity. Business rules and I/O routinely
end up in the same service class, so nothing structurally prevents a replay path
from calling a model. The central guarantee would rest on discipline.

### Generic Hexagonal / Ports and Adapters

The same underlying idea, and a reasonable choice.

**Rejected because** it is less prescriptive about naming and placement. Diplomat
fixes the vocabulary and the folder layout, which removes a category of debate and
makes drift easy to spot. This is a preference for explicitness, not a claim that
Hexagonal is wrong — the two are close relatives.

### Pragmatic single module

One module per concern, no enforced layering, side effects wherever convenient.

**Rejected because** the system's most interesting property is a negative one —
what replay must *not* do. Negative properties are exactly what informal structure
fails to preserve. It would also make the safety rules hard to unit test, since
they would be entangled with the browser.

---

## Related

- Service Design Principles
- ADR-002 — TypeScript on Node as Language and Runtime
- ADR-003 — Single Process, CLI-First Composition
- RFC-001 — System Scope & Component Landscape
