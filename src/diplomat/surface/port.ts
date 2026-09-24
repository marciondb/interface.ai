import type { Action } from '../../models/action';
import type { Observation } from '../../models/observation';
import type { SessionCookie } from '../session/port';

export type SurfaceErrorCode = 'not_open' | 'unknown_ref' | 'unsupported_action' | 'snapshot_mismatch';

// One browser, one context, one page per run. Methods reject with a SurfaceError
// (name 'SurfaceError', code SurfaceErrorCode) or with the underlying surface error.
export type SurfaceDriver = {
  // Loads url with the session cookies; calling it again reuses the same page (re-login).
  open(url: string, session: readonly SessionCookie[]): Promise<void>;
  // Unredacted; refs are valid only until the next observe().
  observe(): Promise<Observation>;
  // action.target must be a ref from the latest observation.
  perform(action: Action): Promise<void>;
  close(): Promise<void>;
};
