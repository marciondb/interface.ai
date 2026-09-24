import type { Locator, Page } from 'playwright';
import { errorMessage } from '../../infrastructure/errors';
import type { PageAction, SurfaceAction } from '../../models/action';
import type { PerformOutcome } from '../../models/resolution';
import { SurfaceError } from './errors';
import { stopLoading, trackNavigations } from './navigation-tracker';
import { isTimeout } from './playwright-errors';

type ValueElement = { readonly tagName: string };

function failure(error: unknown): PerformOutcome {
  if (isTimeout(error)) return { status: 'timeout' };
  return { status: 'error', message: errorMessage(error) };
}

async function readValue(locator: Locator, timeout: number): Promise<string> {
  const tag = await locator.evaluate((element: ValueElement) => element.tagName.toLowerCase(), undefined, { timeout });
  const value = ['input', 'select', 'textarea'].includes(tag)
    ? await locator.inputValue({ timeout })
    : await locator.innerText({ timeout });
  return value.trim();
}

async function act(page: Page, action: PageAction, locate: (ref: string) => Locator, timeout: number): Promise<void> {
  switch (action.kind) {
    case 'click':
      await locate(action.ref).click({ timeout });
      return;
    case 'fill':
      await locate(action.ref).fill(action.value, { timeout });
      return;
    case 'select':
      await locate(action.ref).selectOption({ label: action.option }, { timeout });
      return;
    case 'press':
      await locate(action.ref).press(action.key, { timeout });
      return;
    case 'navigate':
      await page.goto(action.url, { timeout, waitUntil: 'commit' });
      return;
    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}

// Page failures become outcomes; an unknown ref (a SurfaceError from locate) rejects. An action
// is done once the navigations it started have loaded, within the same budget.
export async function performAction(
  page: Page,
  action: SurfaceAction,
  locate: (ref: string) => Locator,
  timeout: number,
): Promise<PerformOutcome> {
  const deadline = Date.now() + timeout;
  if (action.kind === 'read') {
    const locator = locate(action.ref);
    try {
      return { status: 'done', value: await readValue(locator, timeout), navigations: [] };
    } catch (error) {
      return failure(error);
    }
  }
  if (action.kind !== 'navigate') locate(action.ref);

  const tracker = trackNavigations(page);
  try {
    await act(page, action, locate, timeout);
    if (await tracker.settle(deadline)) return { status: 'done', navigations: [...tracker.navigations] };
    await stopLoading(page);
    return { status: 'timeout' };
  } catch (error) {
    if (error instanceof SurfaceError) throw error;
    if (isTimeout(error)) await stopLoading(page);
    return failure(error);
  } finally {
    tracker.stop();
  }
}
