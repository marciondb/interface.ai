import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('toolchain', () => {
  it('runs TypeScript, ESM, Zod and Vitest together', () => {
    expect(z.string().parse('ok')).toBe('ok');
  });
});
