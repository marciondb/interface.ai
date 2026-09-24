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

  it('masks a sensitive value shorter than 4 characters only where it is the whole text', () => {
    const rules = { secrets: [], sensitive: [{ value: '25', sensitivity: 'financial' as const }] };
    expect(redactText('row 25 of 125', rules)).toBe('row 25 of 125');
    expect(redactText('25', rules)).toBe('[REDACTED:financial]');
  });

  it('masks URL-encoded and JSON-escaped forms of secrets', () => {
    const rules = { secrets: ['p@ss w/"q"'], sensitive: [] };

    expect(redactText('?pw=p%40ss%20w%2F%22q%22 or p%40ss+w%2F%22q%22', rules)).toBe(`?pw=${SECRET_MASK} or ${SECRET_MASK}`);
    expect(redactText('{"pw":"p@ss w/\\"q\\""}', rules)).toBe(`{"pw":"${SECRET_MASK}"}`);
  });

  it('masks a value that was already partly masked while only part of it was known', () => {
    const member = { value: '10001', sensitivity: 'internal' } as const;
    const early = redactText('New Account Number: 10001MMRAIN025000', { secrets: [], sensitive: [member] });

    expect(early).toBe('New Account Number: [REDACTED:internal]MMRAIN025000');
    expect(redactText(early, { secrets: [], sensitive: [member, { value: '10001MMRAIN025000', sensitivity: 'financial' }] })).toBe(
      'New Account Number: [REDACTED:financial]',
    );
  });

  it('does not treat a value that is only masks as a partial form', () => {
    const rules: RedactionRules = { secrets: ['training'], sensitive: [{ value: 'training', sensitivity: 'financial' }] };

    expect(redactText(`${SECRET_MASK} training`, rules)).toBe(`${SECRET_MASK} ${SECRET_MASK}`);
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
    expect(
      redactDeep({ Authorization: 'Bearer x', api_key: 'k', apiKey: 'k', sessionId: 's', pin: '1234', userPin: '1', otp_code: '9', runId: 'r', stepId: 's', shipping: 'ok', footprint: 'ok' }, rules),
    ).toEqual({
      Authorization: SECRET_MASK,
      api_key: SECRET_MASK,
      apiKey: SECRET_MASK,
      sessionId: SECRET_MASK,
      pin: SECRET_MASK,
      userPin: SECRET_MASK,
      otp_code: SECRET_MASK,
      runId: 'r',
      stepId: 's',
      shipping: 'ok',
      footprint: 'ok',
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
        { ref: 'e3', role: 'cell', name: '4,812.37', frame: 'content' },
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
        { ref: 'e3', role: 'cell', name: '[REDACTED:financial]', frame: 'content' },
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
