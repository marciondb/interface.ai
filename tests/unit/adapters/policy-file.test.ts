import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromPolicyFile } from '../../../src/adapters/policy-file';

const VALID = {
  allowedOrigins: ['http://localhost:8080'],
  allowedRoutes: ['/', '/member/*'],
  allowedActions: ['click', 'read'],
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
      },
    });
  });

  it('ignores sections it does not know', () => {
    expect(fromPolicyFile({ ...VALID, risky: { routes: [] } })).toMatchObject({ ok: true });
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
    });

    expect(result).toEqual({
      ok: false,
      issues: [
        'allowedOrigins: "http://localhost:8080/app" is not an origin',
        'allowedRoutes: "member/*" must start with / and may only end with *',
        'allowedRoutes: "/a*b" must start with / and may only end with *',
        'allowedActions: "delete" is not a verb',
      ],
    });
  });
});
