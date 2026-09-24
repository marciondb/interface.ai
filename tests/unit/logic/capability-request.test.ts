import { describe, expect, it } from 'vitest';
import { checkRequest, renderGoal } from '../../../src/logic/capability-request';
import type { CapabilityRequest, RequestInput } from '../../../src/models/capability-request';
import type { OutcomeCatalog } from '../../../src/models/outcome-catalog';

function inputs() {
  return {
    memberId: { type: 'string', description: 'Member ID', pattern: '^[0-9]{1,12}$', sensitivity: 'internal', example: '10001' },
    accountType: { type: 'string', description: 'Account type', enum: ['Checking', 'Savings'], sensitivity: 'none', example: 'Savings' },
  } satisfies Record<string, RequestInput>;
}

function request(): CapabilityRequest {
  return {
    capability: {
      id: 'member.read-account-balance',
      version: '1.0.1',
      description: 'Read a balance',
      app: { product: 'legacy-member-console', surface: 'web' },
    },
    goal: 'Look up member {{memberId}} and read the balance of their {{accountType}} account',
    inputs: inputs(),
    outputs: { balance: { type: 'string', description: 'Balance', sensitivity: 'financial' } },
    outcomes: ['member_not_found'],
  };
}

const CATALOG: OutcomeCatalog = {
  product: 'legacy-member-console',
  targets: {},
  outcomes: [{ id: 'member_not_found', kind: 'business', when: { kind: 'text_visible', text: 'No records found.' } }],
};

describe('renderGoal', () => {
  it('fills the template with the examples and lists the outputs to read', () => {
    expect(renderGoal(request())).toBe('Look up member 10001 and read the balance of their Savings account (outputs to read: balance)');
  });

  it('tells the model which outputs are already read', () => {
    expect(renderGoal(request(), { read: ['balance'] })).toBe(
      'Look up member 10001 and read the balance of their Savings account (already read: balance; nothing left to read)',
    );
  });

  it('tells the model what a person already did', () => {
    expect(renderGoal(request(), { byHuman: ['click button "Confirm"', 'accept the dialog "Submit?"'] })).toBe(
      'Look up member 10001 and read the balance of their Savings account (a person already did: click button "Confirm", then accept the dialog "Submit?"; outputs to read: balance)',
    );
  });
});

describe('checkRequest', () => {
  it('accepts a consistent request', () => {
    expect(checkRequest(request(), CATALOG)).toEqual([]);
  });

  it('reports goal parameters that are not inputs and inputs missing from the goal', () => {
    const bad = { ...request(), goal: 'Look up member {{memberNumber}}' };

    expect(checkRequest(bad, CATALOG)).toEqual([
      'goal: {{memberNumber}} is not a declared input',
      'inputs.memberId: not used in the goal',
      'inputs.accountType: not used in the goal',
    ]);
  });

  it('reports examples that break their own spec or repeat another example', () => {
    const base = request();
    const bad: CapabilityRequest = {
      ...base,
      inputs: {
        memberId: { ...inputs().memberId, example: 'Savings' },
        accountType: { ...inputs().accountType, example: 'Savings' },
      },
    };

    expect(checkRequest(bad, CATALOG)).toEqual([
      'inputs.memberId.example: must match ^[0-9]{1,12}$',
      'inputs.accountType.example: same as inputs.memberId.example',
    ]);
  });

  it('reports outcomes the catalog does not know and a catalog for another product', () => {
    const catalog = { ...CATALOG, product: 'other-app' };

    expect(checkRequest({ ...request(), outcomes: ['member_not_found', 'session_lost'] }, catalog)).toEqual([
      'catalog: describes other-app, the request targets legacy-member-console',
      'outcomes: session_lost is not in the other-app catalog',
    ]);
  });
});
