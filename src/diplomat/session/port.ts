import type { Observation } from '../../models/observation';

export type SessionCookie = {
  readonly name: string;
  readonly value: string;
};

export type SessionErrorCode = 'invalid_credentials' | 'unreachable' | 'unexpected_response';

export type SessionProvider = {
  // Signs in to the app serving targetUrl and returns the session cookies for the browser.
  // Also how a run re-authenticates after expiry. Rejects with a SessionError (name 'SessionError', code SessionErrorCode).
  establish(targetUrl: string): Promise<readonly SessionCookie[]>;
  // Whether the observation shows the app's sign-in screen, i.e. the session is gone (ADR-013).
  isExpired(observation: Observation): boolean;
};
