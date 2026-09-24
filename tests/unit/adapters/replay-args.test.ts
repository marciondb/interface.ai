import { describe, expect, it } from 'vitest';
import { toReplayRequest } from '../../../src/adapters/replay-args';

describe('toReplayRequest', () => {
  it('builds a request from the CLI flags', () => {
    expect(
      toReplayRequest({
        capability: 'member.read-account-balance@1',
        input: ['memberId=10001', 'accountType=Money Market', 'note=a=b'],
        target: 'http://localhost:9000',
        headed: true,
      }),
    ).toEqual({
      ok: true,
      request: {
        capabilityId: 'member.read-account-balance',
        major: 1,
        inputs: { memberId: '10001', accountType: 'Money Market', note: 'a=b' },
        targetUrl: 'http://localhost:9000/',
      },
      headed: true,
    });
  });

  it('defaults the target and runs headless', () => {
    expect(toReplayRequest({ capability: 'member.read-account-balance@2' })).toMatchObject({
      ok: true,
      request: { major: 2, inputs: {}, targetUrl: 'http://localhost:8080/' },
      headed: false,
    });
  });

  it('reports every problem without echoing input values', () => {
    const result = toReplayRequest({ capability: 'member.read-account-balance', input: ['secret-value', 'a=1', 'a=2'], target: 'ftp://x' });

    expect(result).toEqual({
      ok: false,
      issues: [
        '--capability must look like <id>@<major>, e.g. member.read-account-balance@1',
        '--input must look like name=value',
        '--input a is given more than once',
        '--target must be an http(s) URL',
      ],
    });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it('rejects a missing capability, a malformed id and malformed flag values', () => {
    expect(toReplayRequest({})).toEqual({ ok: false, issues: ['--capability is required, as <id>@<major>'] });
    expect(toReplayRequest({ capability: 'Member@1' })).toEqual({ ok: false, issues: ['--capability id "Member" is malformed'] });
    expect(toReplayRequest({ capability: 'member.x@1', input: 'memberId=1' })).toMatchObject({ ok: false });
  });
});
