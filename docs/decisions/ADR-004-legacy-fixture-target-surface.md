# Purpose-Built Legacy Fixture as Target Surface

| Field | Value |
|---|---|
| **ADR** | ADR-004 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-08-19 |
| **Status** | ACCEPTED |
| **Description** | This ADR documents the decision to build a local, deliberately hostile back-office web console as the target application, rather than automating a public demo site or a desktop application, because deterministic fault injection and control over per-tenant variation cannot be obtained from a third-party surface. |

---

## Context

The system automates back-office applications at financial institutions. Those
applications cannot be used as a development target: access is not available, and
attempting to obtain it would be inappropriate.

A stand-in is therefore required. It has to exercise the properties that make the
real environment difficult:

| Property of the real environment | What the target must provide |
|---|---|
| Legacy, non-semantic markup | Nested tables, presentational elements, no test identifiers, framed content |
| Runtime errors rather than layout drift | Validation errors, "record not found", permission denial, session expiry, transient slowness, application errors — **on demand** |
| Business outcomes distinct from failures | Two separate mechanisms, not interchangeable |
| Irreversible actions | Operations a cautious agent must refuse or escalate |
| Multi-tenant variation | The same product with different identifiers, labels, and layout per institution |
| Authenticated state that is expensive to lose | A session whose loss costs real work |

The pivotal requirement is **on demand**. Demonstrating that replay distinguishes
a recoverable interstitial from a hard failure requires triggering each condition
deliberately and repeatably. No third-party surface offers that.

---

## Decision

Build a **local web application** that imitates a 2000s-era credit-union
back-office console, served over HTTP and driven in a real browser. It lives in
`fixture/` and is treated as a separate concern from the automation system.

The fixture provides:

- **Hostile markup by construction** — nested table layout, presentational
  elements, framework-style generated identifiers, content inside a frame, no
  test identifiers and no accessibility affordances added for automation's benefit
- **A fault injection endpoint** (`POST /_fault`) that arms exactly one
  single-fire fault: slow load, interstitial, session expiry, server error,
  missing control, or an unexpected native dialog
- **Data-driven business outcomes** — specific record identifiers produce "not
  found" and "not authorized" results through ordinary application behavior,
  entirely separate from the fault mechanism
- **A multi-step read flow and a multi-step write flow**, both parameterized
- **Irreversible operations** (Close Account, Post Adjustment) outside the read
  and write flows
- **Tenant configuration** for identifier prefixes, labels, column order, and route
  base; only one tenant (`banktest`) is defined, so cross-tenant variation is
  designed for but not demonstrated
- **An authenticated session** with a real cookie and a real expiry

It has no third-party dependencies, listens on `127.0.0.1` only, and starts with a
single command.

### Separation of concerns

The fixture does not know the automation system exists. It contains no reference
to the system's requirements or design. It is a plain application that happens to
be unpleasant to automate — which is exactly what a real legacy console is.

---

## Consequences

### Positive

- Every runtime condition can be reproduced deterministically, so the error
  taxonomy can be **demonstrated** rather than described
- The hostility is calibrated to the real environment instead of whatever a demo
  site happens to look like
- Tenant-specific values are already configuration, so a second tenant to
  demonstrate reuse is a data change; today only one tenant exists
- No availability risk, no terms-of-service concerns, no real credentials, no real
  personal data
- The reviewer runs one command with no external accounts

### Negative

- Building the target costs effort that produces no automation capability
- A self-authored target invites the objection that it was made convenient to
  automate

### Mitigation for the second point

The fixture is genuinely hostile, and deliberately so: no stable identifiers, no
semantic structure, content inside a frame, generated identifiers derived from
tenant configuration, and a required control whose disappearance is an injectable
fault. The hostility is documented, and the specific real-world problem each
choice reproduces is stated.

---

## Alternatives

### Public demo or sandbox site

An e-commerce test site or a vendor sandbox.

**Rejected because** runtime failure conditions cannot be triggered
deterministically, which makes the most important behaviour impossible to
evidence. Availability and third-party change would also make evidence
irreproducible, and the domain would weaken the story.

### Native desktop application

Closer to part of the real environment, and a legitimate way to lean into the
no-clean-DOM constraint.

**Rejected because** of the cost imposed on anyone running the system: a graphical
runtime, possibly on a different operating system, that may simply fail to start.
A target that cannot be started is a target that cannot be demonstrated. Desktop
remains addressed as a design question — the surface driver is a port precisely so
that supporting it is an added Diplomat rather than a redesign.

### A clean, modern web application

Fast to build and pleasant to automate.

**Rejected because** it contradicts the constraint the system exists to handle.
Succeeding against a clean DOM would prove nothing about the actual problem.

---

## Related

- ADR-001 — Diplomat Architecture as Service Structure
- RFC-001 — System Scope & Component Landscape
- RFC-007 — Surface Abstraction & Multi-Tenant Capability Reuse
