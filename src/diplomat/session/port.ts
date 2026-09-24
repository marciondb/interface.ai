import type { Observation } from '../../models/observation';

export type SessionCookie = {
  readonly name: string;
  readonly value: string;
};

export const SESSION_ERROR_CODES = ['invalid_credentials', 'unreachable', 'unexpected_response'] as const;

export type SessionErrorCode = (typeof SESSION_ERROR_CODES)[number];

// Why establish() could not sign in. The message never carries the username, the password or a cookie.
export type SessionFailure = Error & { readonly name: 'SessionError'; readonly code: SessionErrorCode };

export function isSessionError(error: unknown): error is SessionFailure {
  return error instanceof Error && error.name === 'SessionError' && 'code' in error && (SESSION_ERROR_CODES as readonly unknown[]).includes(error.code);
}

export type SessionProvider = {
  // Signs in to the app serving targetUrl and returns the session cookies for the browser.
  // Also how a run re-authenticates after expiry. Rejects with a SessionFailure, or with what
  // the transport threw.
  establish(targetUrl: string): Promise<readonly SessionCookie[]>;
  // Whether the observation shows the app's sign-in screen, i.e. the session is gone (ADR-013).
  isExpired(observation: Observation): boolean;
};
