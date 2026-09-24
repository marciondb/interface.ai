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

The system records a UI flow once using a language model, then replays it
deterministically with no model in the decision loop. The guarantee that replay
never reasons is enforced structurally, by the dependency graph, rather than by a
runtime flag.

[RFC-001 — System Scope & Component Landscape](rfcs/RFC-001-system-scope-and-component-landscape.md) ·
[Service Design Principles](architecture/service-design-principles.md) ·
[ADR-001 — Diplomat Architecture](decisions/ADR-001-diplomat-architecture.md)

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
| RFC-002 | Capability Artifact — Schema & Contract | PLANNED |
| RFC-003 | Discovery — LLM-Driven Observe / Decide / Act | PLANNED |
| RFC-004 | Deterministic Replay & Execution Result Contract | PLANNED |
| RFC-005 | Human-in-the-Loop Escalation & Session Handoff | PLANNED |
| RFC-006 | Safety, Guardrails & Regulated Data Handling | PLANNED |
| RFC-007 | Surface Abstraction & Multi-Tenant Capability Reuse | PLANNED |

---

## Decisions

| ADR | Title | Status |
|---|---|---|
| [ADR-001](decisions/ADR-001-diplomat-architecture.md) | Diplomat Architecture as Service Structure | ACCEPTED |
| [ADR-002](decisions/ADR-002-typescript-node-stack.md) | TypeScript on Node as Language and Runtime | ACCEPTED |
| [ADR-003](decisions/ADR-003-single-process-cli-composition.md) | Single Process, CLI-First Composition | ACCEPTED |
| [ADR-004](decisions/ADR-004-legacy-fixture-target-surface.md) | Purpose-Built Legacy Fixture as Target Surface | ACCEPTED |
| ADR-005 | Accessibility-Tree-First Perception Model | PLANNED |
| ADR-006 | Playwright as the Computer-Use Driver | PLANNED |
| ADR-007 | Artifact Serialization Format and Versioning | PLANNED |
| ADR-008 | Ordered Locator Candidate Chain | PLANNED |
| ADR-009 | Discriminated-Union Execution Result Contract | PLANNED |
| ADR-010 | LLM Provider and Structured Tool Calling | PLANNED |
| ADR-011 | Guardrail Enforcement at a Single Action Gateway | PLANNED |
| ADR-012 | Same-Session Control Transfer for Human Handoff | PLANNED |
| ADR-013 | Authentication as Environment Precondition | PLANNED |
| ADR-014 | Per-Run Evidence Bundle Layout | PLANNED |
