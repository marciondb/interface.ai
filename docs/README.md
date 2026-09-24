# Design Documentation

This directory is the design record for the computer-use automation system: what
was decided, which alternatives were rejected, and why.

`/REPORT.md` at the repository root is the short design write-up. This directory is
the depth behind it — read `REPORT.md` first, follow the links here when a decision
needs its full reasoning.

Artifacts follow the naming convention `PREFIX-NNN-title` (e.g. `ADR-001`, `RFC-002`).

---

## Structure

```text
docs/
├── README.md
├── architecture/
│   └── service-design-principles.md   # Diplomat layering and dependency rules
├── decisions/                          # ADRs — one decision each
└── rfcs/                               # RFCs — one subsystem or flow each
```

**RFC** — proposes the design of a subsystem or an end-to-end flow: scope,
responsibilities, contracts, non-goals. An RFC cites the ADRs that constrain it.

**ADR** — records a single decision: context, decision, alternatives rejected,
consequences. An ADR is narrow and does not describe a whole subsystem.

---

## Start Here

The system records a UI flow once using a language model — local by default, so
observations never leave the machine — then replays it deterministically with no
model in the decision loop. The guarantee that replay never reasons is enforced
structurally, by the dependency graph, rather than by a runtime flag.

[RFC-001 — System Scope & Component Landscape](rfcs/RFC-001-system-scope-and-component-landscape.md) ·
[Service Design Principles](architecture/service-design-principles.md) ·
[ADR-001 — Diplomat Architecture](decisions/ADR-001-diplomat-architecture.md)

How to run it is in the root [`README.md`](../README.md); sample discovery and replay
runs are indexed in [`evidence/README.md`](../evidence/README.md).

---

## Architecture

| Document | Summary |
|---|---|
| [Service Design Principles](architecture/service-design-principles.md) | Diplomat architecture: domain/boundary separation and strict dependency rules |

---

## RFCs

| RFC | Title | Status |
|---|---|---|
| [RFC-001](rfcs/RFC-001-system-scope-and-component-landscape.md) | System Scope & Component Landscape | ACCEPTED |
| [RFC-002](rfcs/RFC-002-capability-artifact-schema.md) | Capability Artifact — Schema & Contract | ACCEPTED |
| [RFC-003](rfcs/RFC-003-discovery-agent-loop.md) | Discovery — LLM-Driven Observe / Decide / Act | ACCEPTED |
| [RFC-004](rfcs/RFC-004-deterministic-replay.md) | Deterministic Replay & Execution Result Contract | ACCEPTED |
| [RFC-005](rfcs/RFC-005-human-in-the-loop-handoff.md) | Human-in-the-Loop Escalation & Session Handoff | ACCEPTED |
| [RFC-006](rfcs/RFC-006-safety-guardrails.md) | Safety, Guardrails & Regulated Data Handling | ACCEPTED |
| [RFC-007](rfcs/RFC-007-surface-abstraction-and-multi-tenant.md) | Surface Abstraction & Multi-Tenant Capability Reuse (design only) | ACCEPTED |

---

## Decisions

| ADR | Title | Status |
|---|---|---|
| [ADR-001](decisions/ADR-001-diplomat-architecture.md) | Diplomat Architecture as Service Structure | ACCEPTED |
| [ADR-002](decisions/ADR-002-typescript-node-stack.md) | TypeScript on Node as Language and Runtime | ACCEPTED |
| [ADR-003](decisions/ADR-003-single-process-cli-composition.md) | Single Process, CLI-First Composition | ACCEPTED |
| [ADR-004](decisions/ADR-004-legacy-fixture-target-surface.md) | Purpose-Built Legacy Fixture as Target Surface | ACCEPTED |
| [ADR-005](decisions/ADR-005-accessibility-tree-first-perception.md) | Accessibility-Tree-First Perception Model | ACCEPTED |
| [ADR-006](decisions/ADR-006-playwright-driver.md) | Playwright as the Computer-Use Driver | ACCEPTED |
| [ADR-007](decisions/ADR-007-artifact-format-and-versioning.md) | Artifact Serialization Format and Versioning | ACCEPTED |
| [ADR-008](decisions/ADR-008-ordered-locator-candidate-chain.md) | Ordered Locator Candidate Chain | ACCEPTED |
| [ADR-009](decisions/ADR-009-discriminated-union-result-contract.md) | Discriminated-Union Execution Result Contract | ACCEPTED |
| [ADR-010](decisions/ADR-010-llm-provider-and-tool-calling.md) | LLM Provider and Structured Tool Calling | SUPERSEDED by ADR-015 |
| [ADR-011](decisions/ADR-011-single-action-gateway.md) | Guardrail Enforcement at a Single Action Gateway | ACCEPTED |
| [ADR-012](decisions/ADR-012-same-session-control-transfer.md) | Same-Session Control Transfer for Human Handoff | ACCEPTED |
| [ADR-013](decisions/ADR-013-authentication-as-precondition.md) | Authentication as Environment Precondition | ACCEPTED |
| [ADR-014](decisions/ADR-014-per-run-evidence-bundle.md) | Per-Run Evidence Bundle Layout | ACCEPTED |
| [ADR-015](decisions/ADR-015-local-reasoner-schema-constrained.md) | Local Reasoner with Schema-Constrained Output | ACCEPTED |
