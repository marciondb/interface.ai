import type { Capability } from '../../models/capability';

export type LoadResult =
  | { ok: true; capability: Capability; path: string }
  | { ok: false; code: 'not_found' | 'invalid'; path: string; issues: string[] };

export type SaveResult =
  | { ok: true; path: string }
  | { ok: false; code: 'exists' | 'invalid'; path: string; issues: string[] };

// Artifacts are stored as <root>/<id>/<version>.json and validated on every load.
export type ArtifactStore = {
  load(id: string, version: string): Promise<LoadResult>;
  // Highest published version with this major (callers pin a major, ADR-007).
  loadLatest(id: string, major: number): Promise<LoadResult>;
  // Published versions are immutable: refuses to overwrite an existing file.
  save(capability: Capability): Promise<SaveResult>;
};
