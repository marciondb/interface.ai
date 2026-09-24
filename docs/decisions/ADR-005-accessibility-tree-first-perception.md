# Accessibility-Tree-First Perception Model

| Field | Value |
|---|---|
| **ADR** | ADR-005 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | The system perceives a surface primarily through its accessibility tree, with DOM attributes and screenshots as secondary signals, because it is the representation most likely to exist and stay meaningful on legacy web and desktop surfaces alike. |

---

## Context

The agent needs a representation of the current screen to reason over, and replay
needs a way to find the same controls again. Target surfaces are legacy: nested
tables, presentational markup, no test identifiers, content in frames.

Options are the raw DOM, the accessibility tree, a screenshot with coordinates, or
a combination.

## Decision

**The accessibility tree is the primary observation**, one per frame, with each
node reduced to role, accessible name, value, and state.

Secondary signals:

- **DOM attributes** (`id`, `name`) — used as locator fallbacks, never shown to the
  model as the main view
- **Screenshots** — captured for evidence and on failure; not used for targeting
  in v1

Browsers compute implicit roles (textbox, button, link, cell) even when markup
declares none, so the tree is populated on surfaces with no semantic markup at all.

Observations are captured with Playwright's `ariaSnapshot` in AI mode, in its JSON
form, which includes iframe content. Controls with no accessible name (e.g. inputs
with no associated `<label>`, common in the target) carry a `label` taken from
adjacent visible text in the tree; this maps to the label candidate in ADR-008.

## Consequences

**Positive**
- Compact observations: far fewer tokens than raw HTML
- The same concept exists on desktop platforms (UI Automation, AX API), so the
  artifact's targeting vocabulary transfers
- Role + name is stable across cosmetic markup changes

**Negative**
- Controls with no accessible name (unlabelled inputs) are ambiguous and need a
  DOM or structural fallback
- Canvas-rendered or image-only controls are invisible to it

## Alternatives

- **Raw DOM** — rejected: verbose, and depends on exactly the markup quality the
  environment lacks.
- **Screenshot + coordinates only** — rejected for v1: works everywhere but gives
  replay nothing stable to target; coordinates break on any resolution or layout
  change. Kept as a documented last-resort strategy.

## Related

- ADR-008 — Ordered Locator Candidate Chain
- RFC-003 — Discovery
- RFC-007 — Surface Abstraction & Multi-Tenant Capability Reuse
