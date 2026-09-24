# TypeScript on Node as Language and Runtime

| Field | Value |
|---|---|
| **ADR** | ADR-002 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-08-19 |
| **Status** | ACCEPTED |
| **Description** | This ADR documents the choice of TypeScript on Node as the implementation language and runtime, with Zod as the schema layer, driven mainly by the need to express the capability artifact contract once and enforce it both at compile time and at load time. |

---

## Context

The system's central artifact is a **typed, versioned capability contract** that is
written to disk, reviewed by humans, and later loaded and executed. That contract
is the focal point of the design, so the implementation language has to make one
thing easy: defining a schema once and getting *both* static types for the code
*and* runtime validation for untrusted input.

Runtime validation is not optional here. An artifact loaded from disk has crossed
a trust boundary — it may be hand-edited, produced by an older version of the
system, or specialized for a different tenant. It has to be validated before the
replay engine acts on it.

Beyond that, the system needs:

- Mature browser automation, including accessibility-tree access
- An HTTP client for a local or hosted language model
- Fast iteration
- Low friction for a reviewer running it for the first time

---

## Decision

**TypeScript on Node**, in strict mode, with:

| Concern | Choice |
|---|---|
| Language | TypeScript (strict) |
| Runtime | Node LTS |
| Schema & validation | Zod |
| Package manager | npm |

### Rationale

**Zod is the deciding factor.** A Zod schema is simultaneously a runtime validator
and the source of a static type via inference. The capability artifact contract is
therefore written once and enforced in both directions: the compiler stops the
code from constructing an invalid artifact, and the validator stops an invalid
artifact on disk from being executed. Keeping a JSON Schema and a separate set of
hand-written types in sync would be a recurring source of drift in precisely the
part of the system that must not drift.

**Browser automation is strongest here.** Node is the reference ecosystem for
modern browser drivers, including access to the accessibility tree rather than
only the DOM — which matters given the target surfaces.

**One language across the whole system.** The CLI, the surface driver, the model
client, and the domain logic share types directly. The artifact type used by the
synthesizer is literally the type consumed by the replay engine.

**Low setup friction.** `npm install` followed by a documented command is a
familiar path for a reviewer, and the toolchain needs no system-level
dependencies beyond Node and a browser download.

---

## Consequences

### Positive

- One definition of the artifact contract, enforced statically and at runtime
- Types flow across every layer without translation
- Strong browser automation and accessibility-tree support
- Fast edit–run cycle, which matters when iterating against a live surface
- Easy for a reviewer to run

### Negative

- Node's single-threaded model would need care if replay were ever parallelized at
  scale; not a concern at the current scope
- Strict TypeScript adds friction when modelling dynamic, partially-known shapes
  such as raw model output — mitigated by treating those shapes as Wire and
  validating at the boundary
- Runtime type erasure means validation must be applied deliberately; forgetting
  it is a real failure mode, which is why validation is an Adapter responsibility
  rather than an ad-hoc call

---

## Alternatives

### Python

Comparable browser automation, and Pydantic offers the same schema-plus-types
property that motivated Zod.

**Rejected because** the advantage is narrow and the trade-off runs the other way
on tooling: the browser driver ecosystem is somewhat more mature in Node, and
async ergonomics for a long-running observe/act loop are simpler here. This was
the closest alternative and could have been chosen without harming the design.

### Go

Strong determinism story, single-binary distribution, excellent concurrency.

**Rejected because** the browser automation and model-provider ecosystems are less
mature, and the schema layer would require significantly more hand-written code
for the artifact contract. Iteration speed against a live UI would suffer.

### JavaScript without TypeScript

Fewer moving parts in the toolchain.

**Rejected because** the artifact is a typed contract. Discarding static types in
the one system whose main deliverable is a type contract would be incoherent.

---

## Related

- ADR-001 — Diplomat Architecture as Service Structure
- ADR-003 — Single Process, CLI-First Composition
- RFC-002 — Capability Artifact: Schema & Contract
