import { errors } from 'playwright';

// Playwright reports these as plain Errors; only the message tells them apart.
const DETACHED_OR_NAVIGATING = /frame was detached|frame got detached|execution context was destroyed/i;

export function isTimeout(error: unknown): boolean {
  return error instanceof errors.TimeoutError;
}

// The frame a query ran in went away or started loading another document mid-query.
export function isDetachedFrameError(error: unknown): boolean {
  return error instanceof Error && DETACHED_OR_NAVIGATING.test(error.message);
}
