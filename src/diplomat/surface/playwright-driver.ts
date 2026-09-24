import { chromium, errors, type Browser, type BrowserContext, type Locator, type Page, type Request } from 'playwright';
import { toObservation } from '../../adapters/aria-snapshot';
import type { Action } from '../../models/action';
import type { ElementInfo, Navigation, PerformOutcome } from '../../models/resolution';
import { AriaSnapshotWireSchema } from '../../wire/in/aria-snapshot';
import { SurfaceError } from './errors';
import { candidateLocator, scopeOf } from './locators';
import type { SurfaceDriver } from './port';

const LOAD_TIMEOUT_MS = 5_000;
const SNAPSHOT_TIMEOUT_MS = 5_000;
const ACTION_TIMEOUT_MS = 5_000;
// A navigation counts as finished once no frame request has been in flight for this long
// (covers the gap between a redirect response and the request it causes).
const QUIET_MS = 150;
const SETTLE_POLL_MS = 25;

export type PlaywrightDriverOptions = {
  readonly headless?: boolean;
};

type Surface = {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
};

// The few DOM members read inside the page; the project compiles without DOM types.
type DomElement = {
  readonly tagName: string;
  readonly textContent: string | null;
  readonly ownerDocument: { readonly location: { readonly href: string } };
  readonly href?: string;
  readonly formAction?: string;
  readonly form?: { readonly action: string } | null;
  readonly value?: string;
  getAttribute(name: string): string | null;
};

async function launch(headless: boolean): Promise<Surface> {
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    return { browser, context, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Follows the frame navigations an action starts, so perform() returns only after they load.
function trackNavigations(page: Page) {
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
  const onResponse = (response: { request(): Request; url(): string; status(): number }) => {
    if (response.request().isNavigationRequest()) navigations.push({ url: response.url(), status: response.status() });
  };
  page.on('request', onRequest);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);
  page.on('response', onResponse);

  return {
    navigations,
    // false when the deadline passes first.
    async settle(deadline: number): Promise<boolean> {
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

async function readValue(locator: Locator, timeout: number): Promise<string> {
  const tag = await locator.evaluate((element: DomElement) => element.tagName.toLowerCase(), undefined, { timeout });
  const value = ['input', 'select', 'textarea'].includes(tag)
    ? await locator.inputValue({ timeout })
    : await locator.innerText({ timeout });
  return value.trim();
}

// Runs inside the page: no closures and no nested named functions (they do not survive serialization).
function elementInfo(element: DomElement): ElementInfo {
  const tag = element.tagName.toLowerCase();
  const type = (element.getAttribute('type') ?? 'text').toLowerCase();
  const buttonLike = tag === 'button' || (tag === 'input' && ['submit', 'button', 'reset', 'image'].includes(type));
  const implicit: Record<string, string> = { a: 'link', select: 'combobox', textarea: 'textbox', td: 'cell', th: 'columnheader' };
  const role =
    element.getAttribute('role') ??
    (buttonLike ? 'button' : tag === 'input' ? (['checkbox', 'radio'].includes(type) ? type : 'textbox') : (implicit[tag] ?? tag));
  const text = buttonLike && tag === 'input' ? (element.value ?? '') : (element.textContent ?? '');
  const name = (element.getAttribute('aria-label') ?? text).replace(/\s+/g, ' ').trim().slice(0, 200);
  let destination: string | undefined;
  if (tag === 'a' && element.getAttribute('href') !== null) destination = element.href;
  else if (buttonLike && type !== 'reset' && type !== 'button' && element.form) {
    destination = element.getAttribute('formaction') === null ? element.form.action : element.formAction;
  }
  const info: ElementInfo = { role, name, frameUrl: element.ownerDocument.location.href };
  return destination === undefined ? info : { ...info, destination };
}

// Abandons loads still in flight after a timeout, so a retried action starts a fresh request
// instead of joining the one that timed out.
async function stopLoading(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    await frame.evaluate('window.stop()').catch(() => undefined);
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof errors.TimeoutError;
}

function failure(error: unknown): PerformOutcome {
  if (isTimeout(error)) return { status: 'timeout' };
  return { status: 'error', message: error instanceof Error ? error.message.split('\n')[0] : String(error) };
}

export function createPlaywrightDriver(options: PlaywrightDriverOptions = {}): SurfaceDriver {
  const headless = options.headless ?? true;
  let surface: Surface | undefined;
  let refTargets: ReadonlyMap<string, string> = new Map();
  let resolvedTargets = new Map<string, Locator>();
  let observations = 0;

  function current(): Surface {
    if (surface === undefined) throw new SurfaceError('not_open', 'open() has not been called');
    return surface;
  }

  function resetRefs(): void {
    refTargets = new Map();
    resolvedTargets = new Map();
  }

  // Only checks the ref is known; that it belongs to the current observation is the controller's Ground step.
  function locate(page: Page, ref: string | null): Locator {
    const raw = ref === null ? undefined : refTargets.get(ref);
    if (raw !== undefined) return page.locator(`aria-ref=${raw}`);
    const resolved = ref === null ? undefined : resolvedTargets.get(ref);
    if (resolved !== undefined) return resolved;
    throw new SurfaceError('unknown_ref', `${ref ?? 'no target'} is not in the latest observation`);
  }

  async function act(page: Page, action: Action, timeout: number): Promise<void> {
    switch (action.verb) {
      case 'click':
        await locate(page, action.target).click({ timeout });
        return;
      case 'fill':
        await locate(page, action.target).fill(argumentOf(action), { timeout });
        return;
      case 'select':
        await locate(page, action.target).selectOption({ label: argumentOf(action) }, { timeout });
        return;
      case 'press':
        if (action.target === null) await page.keyboard.press(argumentOf(action));
        else await locate(page, action.target).press(argumentOf(action), { timeout });
        return;
      case 'navigate':
        await page.goto(argumentOf(action), { timeout, waitUntil: 'commit' });
        return;
      case 'read':
      case 'finish':
      case 'request_help':
        throw new SurfaceError('unsupported_action', `${action.verb} is not a page action`);
      default: {
        const unhandled: never = action.verb;
        throw new SurfaceError('unsupported_action', String(unhandled));
      }
    }
  }

  return {
    async open(url, session) {
      surface ??= await launch(headless);
      const origin = new URL(url).origin;
      await surface.context.addCookies(session.map((cookie) => ({ name: cookie.name, value: cookie.value, url: origin })));
      resetRefs();
      await surface.page.goto(url, { waitUntil: 'load' });
    },

    async observe() {
      const { page } = current();
      resetRefs();
      await page.waitForLoadState('domcontentloaded', { timeout: LOAD_TIMEOUT_MS });
      for (const frame of page.mainFrame().childFrames()) {
        await frame.waitForLoadState('domcontentloaded', { timeout: LOAD_TIMEOUT_MS });
      }
      const snapshot: unknown = await page.ariaSnapshotJSON({ mode: 'ai', timeout: SNAPSHOT_TIMEOUT_MS });
      const frames = page.mainFrame().childFrames().map((frame) => ({ name: frame.name(), url: frame.url() }));
      const wire = AriaSnapshotWireSchema.safeParse({
        url: page.url(),
        frames,
        nodes: Array.isArray(snapshot) ? snapshot : [snapshot],
      });
      if (!wire.success) throw new SurfaceError('snapshot_mismatch', 'the aria snapshot has an unexpected shape');

      const result = toObservation(wire.data, observations + 1);
      if (!result.ok) throw new SurfaceError('snapshot_mismatch', result.reason);
      observations += 1;
      refTargets = result.refTargets;
      return result.observation;
    },

    async resolve(target) {
      const { page } = current();
      const scope = scopeOf(page, target.frame);
      const counts: number[] = [];
      for (const [candidateIndex, candidate] of target.candidates.entries()) {
        const locator = candidateLocator(scope, candidate);
        // A frame that is missing or mid-navigation matches nothing.
        const count = locator === undefined ? 0 : await locator.count().catch(() => 0);
        counts.push(count);
        if (locator !== undefined && count === 1) {
          const ref = `e${String(refTargets.size + resolvedTargets.size + 1)}`;
          resolvedTargets.set(ref, locator);
          return { status: 'resolved', ref, candidateIndex, strategy: candidate.strategy, counts };
        }
      }
      return { status: 'unresolved', counts };
    },

    async perform(action, performOptions) {
      const { page } = current();
      const timeout = performOptions?.timeoutMs ?? ACTION_TIMEOUT_MS;
      const deadline = Date.now() + timeout;
      if (action.verb === 'read') {
        const locator = locate(page, action.target);
        try {
          return { status: 'done', value: await readValue(locator, timeout), navigations: [] };
        } catch (error) {
          return failure(error);
        }
      }
      if (action.verb === 'finish' || action.verb === 'request_help') {
        throw new SurfaceError('unsupported_action', `${action.verb} is not a page action`);
      }
      if (action.target !== null) locate(page, action.target);

      const tracker = trackNavigations(page);
      try {
        await act(page, action, timeout);
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
    },

    async describe(ref) {
      const { page } = current();
      return locate(page, ref).evaluate(elementInfo, undefined, { timeout: ACTION_TIMEOUT_MS });
    },

    currentUrl() {
      return current().page.url();
    },

    async screenshot() {
      return current().page.screenshot({ fullPage: true, timeout: ACTION_TIMEOUT_MS });
    },

    async close() {
      const closing = surface;
      surface = undefined;
      resetRefs();
      await closing?.browser.close();
    },
  };
}

function argumentOf(action: Action): string {
  if (action.argument === null) throw new SurfaceError('unsupported_action', `${action.verb} needs an argument`);
  return action.argument;
}
