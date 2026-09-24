# Playwright as the Computer-Use Driver

| Field | Value |
|---|---|
| **ADR** | ADR-006 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Playwright is the implementation behind the surface driver port for web surfaces, chosen for accessibility-tree access, frame handling, and control over a live browser session that can be headed for human handoff. |

---

## Context

The surface driver must observe (accessibility tree, screenshots), act (click,
type, select, navigate), handle frames, and keep one live session that a human can
take over mid-run.

## Decision

Use **Playwright** (Chromium) behind the surface driver port. It is a Diplomat
(`src/diplomat/surface/`); no Playwright type crosses into the Domain, and
dependency-cruiser forbids importing Playwright anywhere else in `src/`.

## Consequences

**Positive**
- Accessibility snapshots and frame-aware locators out of the box
- Native dialog handling (`confirm()`), which the target uses
- Headed mode (`--headed`) gives a human a real window to take over (ADR-012)
- Auto-waiting reduces hand-written timing code

**Negative**
- Auto-waiting can hide slowness; replay sets explicit timeouts so slowness is
  classified rather than absorbed
- Browser download adds a setup step

## Alternatives

- **Puppeteer** — rejected: weaker frame and accessibility ergonomics.
- **Selenium/WebDriver** — rejected: more boilerplate, weaker accessibility access.
- **Vendor computer-use agent SDK** — rejected: couples discovery to one provider
  and still needs a separate deterministic executor for replay.

## Related

- ADR-005 — Accessibility-Tree-First Perception Model
- ADR-012 — Same-Session Control Transfer for Human Handoff
- RFC-004 — Deterministic Replay & Execution Result Contract
