# LLM Provider and Structured Tool Calling

| Field | Value |
|---|---|
| **ADR** | ADR-010 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | SUPERSEDED by ADR-015 |
| **Description** | Discovery uses a frontier model through tool calling, with each permitted action type exposed as a typed tool. The provider sits behind the reasoner port and can be swapped. |

---

> **Superseded.** The default reasoner is now a local model with schema-constrained
> output — see [ADR-015](ADR-015-local-reasoner-schema-constrained.md). The reasoner
> port and the rule that model output is validated before use still hold. This
> record is kept for the reasoning that led there.

---

## Context

Discovery needs a model that reliably picks one well-formed action per turn from an
accessibility-tree observation. Free-text output would need fragile parsing.

## Decision

- **Interface:** tool calling. Each action type (`click`, `fill`, `select`,
  `navigate`, `read`, `finish`, `request_help`) is a tool with a typed schema
- **One action per turn**, each with a short `rationale` field recorded as evidence
- **Provider:** Anthropic Claude as the default implementation of the reasoner
  port; provider and model are configuration
- Tool arguments are Wire data, validated by an Adapter before becoming a domain
  decision

## Consequences

**Positive**
- Malformed actions are rejected at the boundary, not executed
- The tool list is the action allowlist the model sees — it cannot express an
  action type the policy does not define
- Rationale per action gives the "what and why" log for free

**Negative**
- Provider-specific tool formats need an Adapter per provider
- Requires a paid API key for discovery (replay needs none)

## Alternatives

- **JSON-mode free output** — rejected: weaker guarantees than tool schemas.
- **Vendor computer-use (screenshot) tools** — rejected for v1: tied to
  screenshot perception (see ADR-005) and to one vendor.

## Related

- ADR-005 — Accessibility-Tree-First Perception Model
- ADR-011 — Guardrail Enforcement at a Single Action Gateway
- RFC-003 — Discovery
