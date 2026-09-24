import type { Page, Request, Response } from 'playwright';
import type { Navigation } from '../../models/resolution';

// A navigation counts as finished once no frame request has been in flight for this long
// (covers the gap between a redirect response and the request it causes).
const QUIET_MS = 150;
const SETTLE_POLL_MS = 25;

export type NavigationTracker = {
  // Every frame navigation response seen since tracking started.
  readonly navigations: readonly Navigation[];
  // Waits until navigations are quiet and every frame has its document; false when the
  // deadline passes first.
  settle(deadline: number): Promise<boolean>;
  stop(): void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Follows the frame navigations an action starts, so perform() returns only after they load.
export function trackNavigations(page: Page): NavigationTracker {
  const pending = new Set<Request>();
  const navigations: Navigation[] = [];
  let lastActivity = Date.now();
  const onRequest = (request: Request) => {
    if (!request.isNavigationRequest()) return;
    pending.add(request);
    lastActivity = Date.now();
  };
  const onDone = (request: Request) => {
    if (!pending.delete(request)) return;
    lastActivity = Date.now();
  };
  const onResponse = (response: Response) => {
    if (response.request().isNavigationRequest()) navigations.push({ url: response.url(), status: response.status() });
  };
  page.on('request', onRequest);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);
  page.on('response', onResponse);

  return {
    navigations,
    async settle(deadline) {
      lastActivity = Math.max(lastActivity, Date.now());
      for (;;) {
        const now = Date.now();
        if (pending.size === 0 && now - lastActivity >= QUIET_MS) break;
        if (now >= deadline) return false;
        await sleep(SETTLE_POLL_MS);
      }
      for (const frame of page.frames()) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        await frame.waitForLoadState('domcontentloaded', { timeout: remaining });
      }
      return true;
    },
    stop() {
      page.off('request', onRequest);
      page.off('requestfinished', onDone);
      page.off('requestfailed', onDone);
      page.off('response', onResponse);
    },
  };
}

// Abandons loads still in flight after a timeout, so a retried action starts a fresh request
// instead of joining the one that timed out.
export async function stopLoading(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    await frame.evaluate('window.stop()').catch(() => undefined);
  }
}
