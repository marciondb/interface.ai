import { describe, expect, it } from 'vitest';
import { errnoCode, errorMessage, truncate } from '../../../src/infrastructure/errors';

describe('errorMessage', () => {
  it('keeps only the first line of an error message', () => {
    expect(errorMessage(new Error('locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting'))).toBe('locator.click: Timeout 5000ms exceeded.');
    expect(errorMessage(new Error('one line'))).toBe('one line');
  });

  it('shows a thrown value that is not an Error as text', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
  });
});

describe('errnoCode', () => {
  it('reads the code of a system call error only', () => {
    expect(errnoCode(Object.assign(new Error('exists'), { code: 'EEXIST' }))).toBe('EEXIST');
    expect(errnoCode(new Error('no code'))).toBeUndefined();
    expect(errnoCode({ code: 'ENOENT' })).toBeUndefined();
    expect(errnoCode(null)).toBeUndefined();
  });
});

describe('truncate', () => {
  it('cuts long text to the limit with an ellipsis', () => {
    expect(truncate('abcdefghij', 8)).toBe('abcde...');
    expect(truncate('abcdefgh', 8)).toBe('abcdefgh');
  });
});
