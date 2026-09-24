import { describe, expect, it } from 'vitest';
import { toDiscoverArgs, toGoalRequest, withVersion, type GoalArgs } from '../../../src/adapters/discover-args';
import type { OutcomeCatalog } from '../../../src/models/outcome-catalog';

const GOAL = 'Look up member {{memberId}} and read the balance of their {{accountType}} account';

const CATALOG: OutcomeCatalog = {
  product: 'legacy-member-console',
  targets: {},
  outcomes: [
    { id: 'member_not_found', kind: 'business', description: 'No member', when: { kind: 'text_visible', text: 'No records found.' } },
    { id: 'member_restricted', kind: 'business', description: 'Restricted', when: { kind: 'text_visible', text: 'not authorized' } },
  ],
};

function goalOf(raw: Record<string, unknown>): GoalArgs {
  const result = toDiscoverArgs(raw);
  if (!result.ok || result.args.source.kind !== 'goal') throw new Error(`expected goal args, got ${JSON.stringify(result)}`);
  return result.args.source.goal;
}

describe('toDiscoverArgs', () => {
  it('builds the arguments from the CLI flags', () => {
    expect(toDiscoverArgs({ request: 'r.json', reasoner: 'hosted', target: 'http://localhost:9000', headed: true, version: '1.2.3' })).toEqual({
      ok: true,
      args: { source: { kind: 'file', path: 'r.json' }, version: '1.2.3', reasoner: 'hosted', targetUrl: 'http://localhost:9000/', headed: true },
    });
  });

  it('defaults to the local reasoner, the fixture and headless', () => {
    expect(toDiscoverArgs({ request: 'r.json' })).toEqual({
      ok: true,
      args: { source: { kind: 'file', path: 'r.json' }, reasoner: 'local', targetUrl: 'http://localhost:8080/', headed: false },
    });
  });

  it('reports every problem at once', () => {
    const result = toDiscoverArgs({ reasoner: 'gpt', target: 'ftp://x', version: 'v1' });

    expect(result).toEqual({
      ok: false,
      issues: [
        '--request <file> or --goal <text> is required',
        '--version must be semver MAJOR.MINOR.PATCH',
        '--reasoner must be local or hosted',
        '--target must be an http(s) URL',
      ],
    });
  });

  it('takes a goal with inputs, outputs and their sensitivities', () => {
    expect(
      goalOf({
        goal: GOAL,
        capability: 'member.read-account-balance',
        input: ['memberId=10001', 'accountType=Savings:none', 'time=10:30:pii'],
        output: ['balance:financial', 'name'],
        outcome: ['member_not_found'],
      }),
    ).toEqual({
      goal: GOAL,
      capabilityId: 'member.read-account-balance',
      product: 'legacy-member-console',
      inputs: [
        { name: 'memberId', example: '10001', sensitivity: 'internal' },
        { name: 'accountType', example: 'Savings', sensitivity: 'none' },
        { name: 'time', example: '10:30', sensitivity: 'pii' },
      ],
      outputs: [
        { name: 'balance', sensitivity: 'financial' },
        { name: 'name', sensitivity: 'internal' },
      ],
      outcomes: ['member_not_found'],
    });
  });

  it('refuses a goal without its capability or outputs, malformed fields and mixed sources, without echoing examples', () => {
    const result = toDiscoverArgs({ goal: GOAL, input: ['hidden-example', 'a=1', 'a=2'] });

    expect(result).toEqual({
      ok: false,
      issues: [
        '--capability <id> is required with --goal',
        '--output is required with --goal, at least once',
        '--input must look like name=example[:sensitivity]',
        '--input a is given more than once',
      ],
    });
    expect(JSON.stringify(result)).not.toContain('hidden-example');
    expect(toDiscoverArgs({ request: 'r.json', goal: GOAL })).toEqual({ ok: false, issues: ['--request and --goal are exclusive: give one'] });
    expect(toDiscoverArgs({ request: 'r.json', output: ['balance'] })).toEqual({ ok: false, issues: ['--output only apply with --goal'] });
  });
});

describe('toGoalRequest', () => {
  const goal = (): GoalArgs => goalOf({ goal: GOAL, capability: 'member.read-account-balance', input: ['memberId=10001', 'accountType=Savings:none'], output: ['balance:financial'] });

  it('builds the capability request, with every catalog outcome by default', () => {
    expect(toGoalRequest(goal(), CATALOG)).toEqual({
      ok: true,
      request: {
        capability: { id: 'member.read-account-balance', version: '1.0.0', description: GOAL, app: { product: 'legacy-member-console', surface: 'web' } },
        goal: GOAL,
        inputs: {
          memberId: { type: 'string', description: 'memberId', sensitivity: 'internal', example: '10001' },
          accountType: { type: 'string', description: 'accountType', sensitivity: 'none', example: 'Savings' },
        },
        outputs: { balance: { type: 'string', description: 'balance', sensitivity: 'financial' } },
        outcomes: ['member_not_found', 'member_restricted'],
      },
    });
  });

  it('uses the given version and outcomes', () => {
    const result = toGoalRequest({ ...goal(), outcomes: ['member_restricted'] }, CATALOG, '2.0.0');

    expect(result).toMatchObject({ ok: true, request: { capability: { version: '2.0.0' }, outcomes: ['member_restricted'] } });
  });

  it('validates like a request file, secret fields included', () => {
    const result = toGoalRequest({ ...goal(), capabilityId: 'Balance', inputs: [{ name: 'pin', example: '1234', sensitivity: 'secret' }] }, CATALOG);

    expect(result).toEqual({
      ok: false,
      issues: [
        'request capability.id: capability id must look like member.read-account-balance',
        'request inputs.pin.sensitivity: secret fields are not allowed (ADR-013)',
      ],
    });
  });
});

describe('withVersion', () => {
  it('replaces only the capability version', () => {
    const built = toGoalRequest(goalOf({ goal: 'Read {{a}}', capability: 'x.y', input: ['a=1'], output: ['b'] }), CATALOG);
    if (!built.ok) throw new Error(built.issues.join('; '));

    expect(withVersion(built.request, '1.4.0').capability).toEqual({ ...built.request.capability, version: '1.4.0' });
    expect(withVersion(built.request, undefined)).toBe(built.request);
  });
});
