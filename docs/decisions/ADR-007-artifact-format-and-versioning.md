# Artifact Serialization Format and Versioning

| Field | Value |
|---|---|
| **ADR** | ADR-007 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Capability artifacts are JSON files validated by a Zod schema, carrying two independent versions: the artifact format version and the capability's own semantic version. |

---

## Context

Artifacts are reviewed by humans, diffed in code review, loaded as untrusted input,
and invoked by agents that depend on their input/output contract.

## Decision

- **Format:** JSON, one file per capability version, stored at
  `capabilities/<capability-id>/<version>.json`
- **Validation:** a Zod schema is the single source of truth; every load is
  validated before execution
- **Two versions:**

| Field | Meaning | Bumped when |
|---|---|---|
| `schemaVersion` | Version of the artifact format itself | The engine's schema changes incompatibly |
| `capability.version` | Semver of this capability | Major: input/output contract changes. Minor: new optional output or outcome. Patch: locator or timing fixes |

Callers pin a capability major version; locator fixes never break them.

A published version is immutable: changes produce a new version file, and the
store refuses to overwrite an existing one.

## Consequences

**Positive**
- Readable and diffable without tooling
- Contract changes are visible in the version number
- Invalid or outdated artifacts fail at load, not mid-run

**Negative**
- JSON has no comments; rationale lives in explicit `notes` fields
- Migrating `schemaVersion` requires a migration step

## Alternatives

- **YAML** — rejected: nicer to read, but implicit typing causes subtle bugs in a
  contract format.
- **Generated code (a script per capability)** — rejected: not declarative, hard for
  an agent to introspect, and executable content is a larger trust surface.

## Related

- ADR-002 — TypeScript on Node as Language and Runtime
- RFC-002 — Capability Artifact: Schema & Contract
