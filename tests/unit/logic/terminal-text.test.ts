import { describe, expect, it } from 'vitest';
import { printable } from '../../../src/logic/terminal-text';

describe('printable', () => {
  it('removes ANSI escape sequences', () => {
    expect(printable('\u001b[2J\u001b[1;31mred\u001b[0m text')).toBe('red text');
    expect(printable('\u001b]0;fake title\u0007after')).toBe('after');
    expect(printable('\u001b]8;;http://evil\u001b\\link\u001b]8;;\u001b\\')).toBe('link');
    expect(printable('a\u001bcb')).toBe('ab');
  });

  it('removes C0 and C1 controls but keeps newlines and ordinary text', () => {
    expect(printable('ok\rfake\u0008\u0007\t\u009b31m line\nnext — café')).toBe('okfake31m line\nnext — café');
  });
});
