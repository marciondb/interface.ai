import { describe, expect, it } from 'vitest';
import { fromCapabilityFile } from '../../../src/adapters/capability-file';
import { bindInputs, validateInputs } from '../../../src/logic/capability-inputs';
import type { Capability } from '../../../src/models/capability';
import { capabilityFile } from '../../support/capabilities';

function capability(change: (file: ReturnType<typeof capabilityFile>) => void = () => undefined): Capability {
  const file = capabilityFile();
  change(file);
  const result = fromCapabilityFile(file);
  if (!result.ok) throw new Error(result.issues.join('\n'));
  return result.capability;
}

const valid = { memberId: '10002', accountType: 'Savings' };

describe('validateInputs', () => {
  it('accepts declared, well-formed inputs', () => {
    expect(validateInputs(capability(), valid)).toEqual({ ok: true, values: valid });
  });

  it.each([
    ['missing', { accountType: 'Savings' }, { input: 'memberId', code: 'missing', message: 'memberId is required' }],
    ['unknown', { ...valid, pin: '1234' }, { input: 'pin', code: 'unknown', message: 'pin is not an input of member.read-account-balance' }],
    ['pattern', { ...valid, memberId: 'abc' }, { input: 'memberId', code: 'pattern', message: 'memberId must match ^[0-9]{1,12}$' }],
    ['enum', { ...valid, accountType: 'savings' }, { input: 'accountType', code: 'enum', message: 'accountType must be one of Checking, Savings, Money Market' }],
  ])('reports %s inputs', (_, raw, error) => {
    expect(validateInputs(capability(), raw)).toEqual({ ok: false, errors: [error] });
  });

  it('reports a non-numeric value for a number input', () => {
    const numeric = capability((file) => {
      Object.assign(file.inputs, { amount: { type: 'number', description: 'Amount', sensitivity: 'financial' } });
    });
    expect(validateInputs(numeric, { ...valid, amount: '12.50' }).ok).toBe(true);
    expect(validateInputs(numeric, { ...valid, amount: '12,50' })).toEqual({
      ok: false,
      errors: [{ input: 'amount', code: 'type', message: 'amount must be a number' }],
    });
  });

  it('reports every problem at once', () => {
    const result = validateInputs(capability(), { memberId: 'x', extra: '1' });
    expect(result.ok || result.errors.map((error) => error.code)).toEqual(['unknown', 'pattern', 'missing']);
  });
});

describe('bindInputs', () => {
  it('replaces placeholders in candidates, actions and checkpoints', () => {
    const bound = bindInputs(capability(), valid);
    expect(bound.targets['detail.balance']?.candidates[0]).toEqual({
      strategy: 'table_cell',
      row: { column: 'Acct Type', equals: 'Savings' },
      column: 'Balance',
    });
    expect(bound.steps[0]?.action).toEqual({ kind: 'fill', target: 'lookup.memberId', value: '10002' });
    expect(bound.steps[0]?.checkpoint).toEqual({ kind: 'value_equals', target: 'lookup.memberId', value: '10002' });
    expect(JSON.stringify(bound)).not.toContain('{{');
  });

  it('leaves the original capability untouched', () => {
    const original = capability();
    bindInputs(original, valid);
    expect(JSON.stringify(original)).toContain('{{inputs.memberId}}');
  });

  it('refuses to bind a placeholder without a value', () => {
    expect(() => bindInputs(capability(), { memberId: '10002' })).toThrow('no value bound for input accountType');
  });
});
