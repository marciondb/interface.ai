import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionError } from '../../../src/diplomat/session/errors';
import { createFixtureSessionProvider } from '../../../src/diplomat/session/fixture-login';
import { isSessionError } from '../../../src/diplomat/session/port';
import { startFixture, type FixtureHandle } from '../../support/fixture';
import { loginObservation } from '../../support/observations';

async function rejection(promise: Promise<unknown>): Promise<SessionError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SessionError);
  expect(isSessionError(error)).toBe(true);
  return error as SessionError;
}

describe('isSessionError', () => {
  it('recognizes only errors named SessionError with a known code', () => {
    expect(isSessionError(new SessionError('unreachable', 'down'))).toBe(true);
    expect(isSessionError(Object.assign(new Error('x'), { name: 'SessionError' }))).toBe(false);
    expect(isSessionError(Object.assign(new Error('x'), { name: 'SessionError', code: 'other' }))).toBe(false);
    expect(isSessionError({ name: 'SessionError', code: 'unreachable' })).toBe(false);
  });
});

describe('fixture session provider', () => {
  let fixture: FixtureHandle;

  beforeAll(async () => {
    fixture = await startFixture();
  }, 30_000);

  afterAll(async () => {
    await fixture.stop();
  });

  it('returns the session cookie for valid credentials', async () => {
    const provider = createFixtureSessionProvider({ username: 'operator', password: 'training' });

    const cookies = await provider.establish(`${fixture.baseUrl}/`);

    const session = cookies.find((cookie) => cookie.name === 'ASP.NET_SessionId');
    expect(session?.value).toMatch(/^[0-9a-f]+$/);
  });

  it('reports invalid credentials without echoing them', async () => {
    const provider = createFixtureSessionProvider({ username: 'operator', password: 'wrong-secret-42' });

    const error = await rejection(provider.establish(`${fixture.baseUrl}/`));

    expect(error.code).toBe('invalid_credentials');
    expect(error.message).not.toContain('wrong-secret-42');
    expect(error.message).not.toContain('operator');
  });

  it('reports an unreachable app', async () => {
    const provider = createFixtureSessionProvider({ username: 'operator', password: 'training' });

    const error = await rejection(provider.establish('http://127.0.0.1:1/'));

    expect(error.code).toBe('unreachable');
  });

  it('reports any other answer as unexpected', async () => {
    const provider = createFixtureSessionProvider({
      username: 'operator',
      password: 'training',
      fetch: () => Promise.resolve(new Response('boom', { status: 500 })),
    });

    const error = await rejection(provider.establish(`${fixture.baseUrl}/`));

    expect(error.code).toBe('unexpected_response');
    expect(error.message).toContain('500');
  });

  it('treats the sign-in screen in any frame as an expired session', () => {
    const provider = createFixtureSessionProvider({ username: 'operator', password: 'training' });
    const shell = {
      ...loginObservation(),
      url: 'http://localhost:8080/',
      frames: [
        { name: null, url: 'http://localhost:8080/' },
        { name: 'content', url: 'http://localhost:8080/member/search' },
      ],
    };

    expect(provider.isExpired(loginObservation())).toBe(true);
    expect(provider.isExpired(shell)).toBe(false);
    expect(
      provider.isExpired({ ...shell, frames: [...shell.frames.slice(0, 1), { name: 'content', url: 'http://localhost:8080/login' }] }),
    ).toBe(true);
  });
});
