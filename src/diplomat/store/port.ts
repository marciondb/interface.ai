import type { Capability, CapabilityStatus } from '../../models/capability';

export type LoadResult =
  | { ok: true; capability: Capability; status: CapabilityStatus; path: string }
  | { ok: false; code: 'not_found' | 'invalid'; path: string; issues: string[] };

export type SaveResult =
  | { ok: true; path: string }
  | { ok: false; code: 'exists' | 'invalid'; path: string; issues: string[] };

export type LoadLatestOptions = {
  // Also resolve to unreviewed drafts; only for trying out a freshly discovered artifact.
  readonly includeDrafts?: boolean;
};

// Artifacts are stored as <root>/<id>/<version>.json and validated on every load.
export type ArtifactStore = {
  // Any status: an exact version is an explicit choice.
  load(id: string, version: string): Promise<LoadResult>;
  // Highest approved version with this major (callers pin a major, ADR-007); drafts are
  // skipped unless included, here or by the store's default.
  loadLatest(id: string, major: number, options?: LoadLatestOptions): Promise<LoadResult>;
  // Published versions are immutable: refuses to overwrite an existing file.
  save(capability: Capability): Promise<SaveResult>;
};
