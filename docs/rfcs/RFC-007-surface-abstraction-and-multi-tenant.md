# Surface Abstraction & Multi-Tenant Capability Reuse (design only)

---

| Field | Value |
|---|---|
| **RFC** | RFC-007 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Describes how the design extends to legacy web and desktop surfaces and to reuse across institutions running the same product. Seams exist in code; the extensions are not implemented. |

---

## Surface abstraction

The seam is the **surface driver port**:

```ts
type SurfaceDriver = {
  open(url: string, session: readonly SessionCookie[]): Promise<void>   // one browser/page per run
  observe(): Promise<Observation>          // accessibility tree per frame/window
  resolve(target: TargetSpec): Promise<Resolution>   // candidate chain → ref (ADR-008)
  perform(action: Action, options?: { timeoutMs?: number }): Promise<PerformOutcome>   // done | timeout | error
  describe(ref: string): Promise<ElementInfo>
  inspect(ref: string): Promise<ElementDescriptor>   // observation ref → how to find it again
  currentUrl(): string
  screenshot(): Promise<Uint8Array>
  close(): Promise<void>
}
```

A handoff also needs the driver's `HumanSurface` side (observe, screenshot, and
capture of what a human does in the live window); it offers no way to act.

An `ElementDescriptor` carries what the observation node does not — identifying
attributes, the adjacent label, and for table cells the column header and row
cells — which synthesis combines with the node's role/name to build candidate
chains.

The artifact speaks in surface-neutral terms — roles, names, labels, structural
relations — so the same schema works across surfaces:

| Surface | Driver | Notes |
|---|---|---|
| Modern / legacy web | Playwright (v1) | Frames and framesets are part of `TargetSpec.frame` |
| Windows desktop | UI Automation | Same role/name model |
| macOS desktop | AX API | Same role/name model |
| No accessibility at all (Citrix, canvas) | Screenshot + vision locator | Last-resort `strategy: "visual"` candidate |

Adding a surface is a new Diplomat. Artifacts, replay, policy, and classification
do not change.

## Multi-tenant reuse

Many institutions run the same vendor product with different branding, labels,
ids, column order, and versions.

**Layered artifacts:**

```text
capabilities/<id>/<version>.json          # base, recorded once per product version
tenants/<tenant>/<id>.overlay.json        # overrides: targets, outcome texts, routes
```

- An overlay can replace **targets** and **outcome detectors** only — never steps,
  inputs, or outputs. The contract stays identical across tenants
- Resolution: `base + overlay → effective artifact`, validated like any artifact
- Tenant config (`product`, `productVersion`) selects the base

**Drift detection:**

- Replay records which locator candidate matched (ADR-008). A tenant that
  consistently falls back to lower candidates is drifting
- A checkpoint failure concentrated in one tenant after a vendor upgrade flags a
  product-version split, which becomes a new base version
- Canonicalization at synthesis (`/member/10001` → `/member/:id`, tenant-specific
  ids → role/label candidates first) keeps base artifacts tenant-neutral

The target application demonstrates the need: its tenant config changes ids,
labels, and column order.

## Not implemented

- Desktop drivers
- Overlay resolution and tenant registry
- Drift dashboards

## Related

- ADR-004 — Purpose-Built Legacy Fixture as Target Surface
- ADR-005 — Accessibility-Tree-First Perception Model
- ADR-007 — Artifact Serialization Format and Versioning
- ADR-008 — Ordered Locator Candidate Chain
- RFC-002 — Capability Artifact: Schema & Contract
