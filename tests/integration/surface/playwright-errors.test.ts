import { errors } from 'playwright';
import { describe, expect, it } from 'vitest';
import { SurfaceError } from '../../../src/diplomat/surface/errors';
import { translated } from '../../../src/diplomat/surface/playwright-errors';

describe('translated', () => {
  it('turns a Playwright timeout into a timeout SurfaceError', async () => {
    await expect(translated(() => Promise.reject(new errors.TimeoutError('locator.click: Timeout 5000ms exceeded.')))).rejects.toMatchObject({
      name: 'SurfaceError',
      code: 'timeout',
    });
  });

  it('treats a frame replaced mid-read as a timeout', async () => {
    await expect(translated(() => Promise.reject(new Error('frame.evaluate: Execution context was destroyed')))).rejects.toMatchObject({ code: 'timeout' });
  });

  it('reports any other browser error as driver_error, first line only', async () => {
    await expect(translated(() => Promise.reject(new Error('Target page, context or browser has been closed\ncall log...')))).rejects.toMatchObject({
      code: 'driver_error',
      message: 'surface driver_error: Target page, context or browser has been closed',
    });
  });

  it('passes SurfaceErrors and bugs through unchanged', async () => {
    const own = new SurfaceError('unknown_ref', 'e9 is not in the latest observation');
    await expect(translated(() => Promise.reject(own))).rejects.toBe(own);
    await expect(translated(() => Promise.reject(new TypeError('x is not a function')))).rejects.toBeInstanceOf(TypeError);
  });
});
