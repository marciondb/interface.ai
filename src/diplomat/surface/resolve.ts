import type { Locator, Page } from 'playwright';
import { errorMessage } from '../../infrastructure/errors';
import type { TargetSpec } from '../../models/capability';
import type { Resolution } from '../../models/resolution';
import { SurfaceError } from './errors';
import { candidateLocators, scopeOf } from './locators';
import { isDetachedFrameError } from './playwright-errors';

// A frame that went away or is loading another document matches nothing; any other failure
// to count is the driver's, not an absence.
async function countOf(locator: Locator): Promise<number> {
  try {
    return await locator.count();
  } catch (error) {
    if (isDetachedFrameError(error)) return 0;
    throw new SurfaceError('driver_error', `could not count matches: ${errorMessage(error)}`);
  }
}

// The candidate's match: its first alternative that matches anything, with that count.
async function matchOf(alternatives: readonly Locator[]): Promise<{ readonly locator?: Locator; readonly count: number }> {
  for (const locator of alternatives) {
    const count = await countOf(locator);
    if (count > 0) return { locator, count };
  }
  return { count: 0 };
}

// Tries the candidates in order; the first matching exactly one element is registered through
// mint (ADR-008).
export async function resolveTarget(page: Page, target: TargetSpec, mint: (locator: Locator) => string): Promise<Resolution> {
  const scope = scopeOf(page, target.frame);
  const counts: number[] = [];
  for (const [candidateIndex, candidate] of target.candidates.entries()) {
    const { locator, count } = await matchOf(candidateLocators(scope, candidate));
    counts.push(count);
    if (locator !== undefined && count === 1) {
      return { status: 'resolved', ref: mint(locator), candidateIndex, strategy: candidate.strategy, counts };
    }
  }
  return { status: 'unresolved', counts };
}
