import { describe, expect, it } from 'vitest';
import { redactSecrets, SECRET_MASK } from '../../../src/logic/redaction';

describe('redactSecrets', () => {
  it('masks every occurrence in nested strings and leaves other values alone', () => {
    const record = { note: 'Password training, again training', nodes: [{ name: 'training' }, 3, null], ok: true };

    expect(redactSecrets(record, ['training'])).toEqual({
      note: `Password ${SECRET_MASK}, again ${SECRET_MASK}`,
      nodes: [{ name: SECRET_MASK }, 3, null],
      ok: true,
    });
  });

  it('ignores empty secrets', () => {
    expect(redactSecrets({ a: 'text' }, [''])).toEqual({ a: 'text' });
  });
});
