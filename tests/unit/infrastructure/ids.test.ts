import { describe, expect, it } from 'vitest';
import { newId } from '../../../src/infrastructure/ids';
import { redactText } from '../../../src/logic/redaction';

describe('newId', () => {
  it('is the prefix and one hex token', () => {
    expect(newId('int')).toMatch(/^int-[0-9a-f]{32}$/);
  });

  it('survives evidence redaction even when the token is mostly digits', () => {
    const id = 'int-47994209123456789012345678901234';

    expect(redactText(id, { secrets: [], sensitive: [] })).toBe(id);
  });
});
