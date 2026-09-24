import { SessionError } from './errors';
import type { SessionCookie, SessionProvider } from './port';

// Login form of the target app (ADR-013: the session provider is per-app code).
const LOGIN_PATH = '/login';
const USERNAME_FIELD = 'ctl00$ContentPlaceHolder1$txtUserId';
const PASSWORD_FIELD = 'ctl00$ContentPlaceHolder1$txtPassword';
const SUBMIT_FIELD = 'ctl00$ContentPlaceHolder1$btnPrimary';
const SUBMIT_VALUE = 'Sign On';
const SESSION_COOKIE = 'ASP.NET_SessionId';
const TIMEOUT_MS = 10_000;

export type FixtureSessionOptions = {
  readonly username: string;
  readonly password: string;
  readonly fetch?: typeof globalThis.fetch;
};

function parseSetCookie(header: string): SessionCookie | undefined {
  const pair = header.split(';', 1)[0] ?? '';
  const separator = pair.indexOf('=');
  if (separator <= 0) return undefined;
  return { name: pair.slice(0, separator).trim(), value: pair.slice(separator + 1).trim() };
}

export function createFixtureSessionProvider(options: FixtureSessionOptions): SessionProvider {
  const { username, password } = options;
  const fetch = options.fetch ?? globalThis.fetch;

  return {
    async establish(targetUrl) {
      const loginUrl = new URL(LOGIN_PATH, targetUrl).href;
      const body = new URLSearchParams({
        [USERNAME_FIELD]: username,
        [PASSWORD_FIELD]: password,
        [SUBMIT_FIELD]: SUBMIT_VALUE,
      });

      let response: Response;
      try {
        response = await fetch(loginUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new SessionError('unreachable', `could not reach ${loginUrl}`);
      }
      await response.body?.cancel();

      if (response.status === 200) {
        throw new SessionError('invalid_credentials', 'the app rejected the configured credentials');
      }
      const cookies = response.headers.getSetCookie().flatMap((header) => parseSetCookie(header) ?? []);
      if (response.status !== 302 || !cookies.some((cookie) => cookie.name === SESSION_COOKIE)) {
        throw new SessionError('unexpected_response', `login answered HTTP ${String(response.status)} without a session`);
      }
      return cookies;
    },
  };
}
