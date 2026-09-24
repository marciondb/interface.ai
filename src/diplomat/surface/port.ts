import type { Action } from '../../models/action';
import type { TargetSpec } from '../../models/capability';
import type { Observation } from '../../models/observation';
import type { ElementInfo, PerformOutcome, Resolution } from '../../models/resolution';
import type { SessionCookie } from '../session/port';

export type SurfaceErrorCode = 'not_open' | 'unknown_ref' | 'unsupported_action' | 'snapshot_mismatch';

export type PerformOptions = {
  // Budget for the action and for the navigations it starts to finish loading (default 5000).
  readonly timeoutMs?: number;
};

// One browser, one context, one page per run. Methods reject with a SurfaceError
// (name 'SurfaceError', code SurfaceErrorCode) or with the underlying surface error.
export type SurfaceDriver = {
  // Loads url with the session cookies; calling it again reuses the same page (re-login).
  open(url: string, session: readonly SessionCookie[]): Promise<void>;
  // Unredacted; refs are valid only until the next observe().
  observe(): Promise<Observation>;
  // Tries the candidates in order; the first with exactly one match gets a ref (ADR-008),
  // valid until the next observe().
  resolve(target: TargetSpec): Promise<Resolution>;
  // action.target must be a ref from the latest observe() or a later resolve().
  // Page failures are outcomes; only misuse (unknown ref, unsupported verb) rejects.
  perform(action: Action, options?: PerformOptions): Promise<PerformOutcome>;
  describe(ref: string): Promise<ElementInfo>;
  currentUrl(): string;
  // PNG of the full page.
  screenshot(): Promise<Uint8Array>;
  close(): Promise<void>;
};
