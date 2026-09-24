import type { SessionErrorCode } from './port';

// The message never carries the username, the password, or a cookie value.
export class SessionError extends Error {
  override readonly name = 'SessionError';

  constructor(
    readonly code: SessionErrorCode,
    detail: string,
  ) {
    super(`session ${code}: ${detail}`);
  }
}
