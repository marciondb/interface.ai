import { errors } from 'playwright';
import { errorMessage, isProgrammingError } from '../../infrastructure/errors';
import { SurfaceError } from './errors';
import { isSurfaceError } from './port';

// Playwright reports these as plain Errors; only the message tells them apart.
const DETACHED_OR_NAVIGATING = /frame was detached|frame got detached|execution context was destroyed/i;

export function isTimeout(error: unknown): boolean {
  return error instanceof errors.TimeoutError;
}

// The frame a query ran in went away or started loading another document mid-query.
export function isDetachedFrameError(error: unknown): boolean {
  return error instanceof Error && DETACHED_OR_NAVIGATING.test(error.message);
}

// The port's contract: Playwright's errors never leave the driver.
export async function translated<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (isSurfaceError(error) || isProgrammingError(error)) throw error;
    throw new SurfaceError(isTimeout(error) || isDetachedFrameError(error) ? 'timeout' : 'driver_error', errorMessage(error));
  }
}
