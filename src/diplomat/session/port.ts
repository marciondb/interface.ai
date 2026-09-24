export type SessionCookie = {
  readonly name: string;
  readonly value: string;
};

export type SessionErrorCode = 'invalid_credentials' | 'unreachable' | 'unexpected_response';

export type SessionProvider = {
  // Signs in to the app serving targetUrl and returns the session cookies for the browser.
  // Rejects with a SessionError (name 'SessionError', code SessionErrorCode).
  establish(targetUrl: string): Promise<readonly SessionCookie[]>;
};
