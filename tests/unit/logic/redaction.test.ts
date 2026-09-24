import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromCapabilityFile } from '../../../src/adapters/capability-file';
import { redactDeep, redactObservation, redactText, SECRET_MASK, sensitiveValuesOf, type RedactionRules } from '../../../src/logic/redaction';
import type { Observation } from '../../../src/models/observation';

const NONE: RedactionRules = { secrets: [], sensitive: [] };

describe('redactText', () => {
  it('keeps only the last 4 digits of account-number-like runs', () => {
    expect(redactText('Account 100018830 opened', NONE)).toBe('Account *****8830 opened');
    expect(redactText('ref 1234567', NONE)).toBe('ref 1234567');
  });

  it('masks SSN-like strings', () => {
    expect(redactText('SSN 123-45-6789.', NONE)).toBe('SSN ***-**-****.');
  });

  it('masks secrets in any case', () => {
    const rules = { secrets: ['training'], sensitive: [] };

    expect(redactText('Password: training (TRAINING, Training)', rules)).toBe(`Password: ${SECRET_MASK} (${SECRET_MASK}, ${SECRET_MASK})`);
    expect(redactText('a.b*c', { secrets: ['.b*'], sensitive: [] })).toBe(`a${SECRET_MASK}c`);
    expect(redactText('text', { secrets: [''], sensitive: [] })).toBe('text');
  });

  it('masks declared sensitive values by sensitivity, longest first', () => {
    const rules: RedactionRules = {
      secrets: [],
      sensitive: [
        { value: '4,812.37', sensitivity: 'financial' },
        { value: '10001', sensitivity: 'internal' },
        { value: '100012', sensitivity: 'pii' },
      ],
    };

    expect(redactText('Member ID: 10001 Search, balance 4,812.37, other 100012', rules)).toBe(
      'Member ID: [REDACTED:internal] Search, balance [REDACTED:financial], other [REDACTED:pii]',
    );
  });

  it('ignores sensitive values shorter than 4 characters', () => {
    expect(redactText('row 12 of 123', { secrets: [], sensitive: [{ value: '12', sensitivity: 'internal' }] })).toBe('row 12 of 123');
  });
});

describe('redactDeep', () => {
  const rules: RedactionRules = { secrets: ['training'], sensitive: [{ value: '4,812.37', sensitivity: 'financial' }] };

  it('redacts nested strings without mutating the input', () => {
    const record = { note: 'training', nodes: [{ name: 'Balance 4,812.37' }, 3, null], ok: true };
    const copy = structuredClone(record);

    expect(redactDeep(record, rules)).toEqual({ note: SECRET_MASK, nodes: [{ name: 'Balance [REDACTED:financial]' }, 3, null], ok: true });
    expect(record).toEqual(copy);
  });

  it('masks fields named like credentials whole', () => {
    expect(redactDeep({ password: 'x', sessionToken: 1, cookies: [{ value: 'y' }], clientSecret: 'z', name: 'n' }, rules)).toEqual({
      password: SECRET_MASK,
      sessionToken: SECRET_MASK,
      cookies: SECRET_MASK,
      clientSecret: SECRET_MASK,
      name: 'n',
    });
  });
});

describe('redactObservation', () => {
  it('masks names, labels, values, text nodes and URLs, keeping refs and roles', () => {
    const observation: Observation = {
      observationId: 3,
      url: 'http://localhost:8080/',
      frames: [
        { name: null, url: 'http://localhost:8080/' },
        { name: 'content', url: 'http://localhost:8080/member/detail?memberId=10001' },
      ],
      nodes: [
        { ref: 'e1', role: 'cell', name: 'Member ID: 10001 Search', frame: 'content' },
        { ref: 'e2', role: 'textbox', name: '', label: 'Member ID:', value: '10001', frame: 'content' },
        { role: 'text', name: 'Password hint: training', frame: null },
        { ref: 'e3', role: 'cell', name: '4,812.37', frame: 'content', attributes: { id: 'acct-100018830' } },
      ],
      dialog: { type: 'alert', message: 'Member 10001 updated' },
    };
    const rules: RedactionRules = {
      secrets: ['training'],
      sensitive: [
        { value: '10001', sensitivity: 'internal' },
        { value: '4,812.37', sensitivity: 'financial' },
      ],
    };

    expect(redactObservation(observation, rules)).toEqual({
      observationId: 3,
      url: 'http://localhost:8080/',
      frames: [
        { name: null, url: 'http://localhost:8080/' },
        { name: 'content', url: 'http://localhost:8080/member/detail?memberId=[REDACTED:internal]' },
      ],
      nodes: [
        { ref: 'e1', role: 'cell', name: 'Member ID: [REDACTED:internal] Search', frame: 'content' },
        { ref: 'e2', role: 'textbox', name: '', label: 'Member ID:', value: '[REDACTED:internal]', frame: 'content' },
        { role: 'text', name: `Password hint: ${SECRET_MASK}`, frame: null },
        { ref: 'e3', role: 'cell', name: '[REDACTED:financial]', frame: 'content', attributes: { id: 'acct-*****8830' } },
      ],
      dialog: { type: 'alert', message: 'Member [REDACTED:internal] updated' },
    });
  });
});

describe('sensitiveValuesOf', () => {
  it('returns the values of declared fields whose sensitivity is not none', () => {
    const raw: unknown = JSON.parse(readFileSync(new URL('../../../capabilities/member.read-account-balance/1.0.0.json', import.meta.url), 'utf8'));
    const parsed = fromCapabilityFile(raw);
    if (!parsed.ok) throw new Error(parsed.issues.join('; '));

    expect(sensitiveValuesOf(parsed.capability, { memberId: '10001', accountType: 'Savings', extra: 'x' }, { balance: '4,812.37' })).toEqual([
      { value: '10001', sensitivity: 'internal' },
      { value: '4,812.37', sensitivity: 'financial' },
    ]);
  });
});
