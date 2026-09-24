import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromPolicyFile } from '../../../src/adapters/policy-file';

const RISKY = { routes: ['/member/danger/*'], controlText: ['Close Account'] };

const VALID = {
  allowedOrigins: ['http://localhost:8080'],
  allowedRoutes: ['/', '/member/*'],
  allowedActions: ['click', 'read'],
  risky: RISKY,
};

describe('fromPolicyFile', () => {
  it('accepts the committed policy.json', () => {
    const raw: unknown = JSON.parse(readFileSync(new URL('../../../policy.json', import.meta.url), 'utf8'));

    expect(fromPolicyFile(raw)).toEqual({
      ok: true,
      policy: {
        allowedOrigins: ['http://localhost:8080'],
        allowedRoutes: ['/', '/welcome', '/member/*'],
        allowedActions: ['click', 'fill', 'select', 'navigate', 'read'],
        risky: { routes: ['/member/danger/*'], controlText: ['Close Account', 'Post Adjustment', 'Confirm'] },
      },
    });
  });

  it('ignores sections it does not know', () => {
    expect(fromPolicyFile({ ...VALID, tenants: {} })).toMatchObject({ ok: true });
  });

  it('fails closed without risky rules', () => {
    const withoutRisky: Record<string, unknown> = { ...VALID };
    delete withoutRisky.risky;

    expect(fromPolicyFile(withoutRisky)).toEqual({ ok: false, issues: [expect.stringContaining('risky') as unknown] });
    expect(fromPolicyFile({ ...VALID, risky: { routes: [] } })).toMatchObject({ ok: false });
  });

  it('rejects a malformed file', () => {
    expect(fromPolicyFile({ allowedOrigins: 'http://localhost:8080' })).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.stringContaining('allowedOrigins')]) as unknown,
    });
    expect(fromPolicyFile(null)).toMatchObject({ ok: false });
  });

  it('rejects entries that are not origins, routes or verbs', () => {
    const result = fromPolicyFile({
      allowedOrigins: ['http://localhost:8080/app'],
      allowedRoutes: ['member/*', '/a*b'],
      allowedActions: ['click', 'delete'],
      risky: { routes: ['danger'], controlText: [' '] },
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        'allowedOrigins: "http://localhost:8080/app" is not an origin',
        'allowedRoutes: "member/*" must start with / and may only end with *',
        'allowedRoutes: "/a*b" must start with / and may only end with *',
        'allowedActions: "delete" is not a verb',
        'risky.routes: "danger" must start with / and may only end with *',
        'risky.controlText: entries must not be blank',
      ],
    });
  });
});
