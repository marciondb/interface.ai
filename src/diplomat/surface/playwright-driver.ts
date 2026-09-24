import { chromium, errors, type Browser, type BrowserContext, type Dialog as PageDialog, type Frame, type Locator, type Page, type Request } from 'playwright';
import { toObservation } from '../../adapters/aria-snapshot';
import type { Action } from '../../models/action';
import type { ElementDescriptor } from '../../models/element-descriptor';
import { HumanActionSchema, type DialogDecision } from '../../models/intervention';
import type { Dialog } from '../../models/observation';
import type { ElementInfo, Navigation, PerformOutcome } from '../../models/resolution';
import { AriaSnapshotWireSchema } from '../../wire/in/aria-snapshot';
import { SurfaceError } from './errors';
import { HUMAN_CAPTURE_SCRIPT, HUMAN_EVENT_BINDING } from './human-capture-script';
import { candidateLocator, scopeOf } from './locators';
import type { HumanCaptureListener, HumanSurface, SurfaceDriver } from './port';

const LOAD_TIMEOUT_MS = 5_000;
const SNAPSHOT_TIMEOUT_MS = 5_000;
const ACTION_TIMEOUT_MS = 5_000;
// A navigation counts as finished once no frame request has been in flight for this long
// (covers the gap between a redirect response and the request it causes).
const QUIET_MS = 150;
const SETTLE_POLL_MS = 25;
// Human reports kept per capture; the rest are dropped.
const MAX_HUMAN_EVENTS = 200;

export type PlaywrightDriverOptions = {
  readonly headless?: boolean;
};

// The page itself is exposed for tests that play the human operator.
export type PlaywrightDriver = SurfaceDriver & HumanSurface & { page(): Page };

type Surface = {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
};

type TextNode = { readonly textContent: string | null };

// The few DOM members read inside the page; the project compiles without DOM types.
type DomElement = {
  readonly tagName: string;
  readonly textContent: string | null;
  readonly ownerDocument: { readonly location: { readonly href: string }; getElementById(id: string): TextNode | null };
  readonly href?: string;
  readonly formAction?: string;
  readonly form?: { readonly action: string } | null;
  readonly value?: string;
  readonly labels?: ArrayLike<TextNode> | null;
  getAttribute(name: string): string | null;
  querySelectorAll(selectors: string): ArrayLike<{ getAttribute(name: string): string | null }>;
};

async function launch(headless: boolean, prepare: (context: BrowserContext) => Promise<void>): Promise<Surface> {
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext();
    await prepare(context);
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
  const ownerDocument = element.ownerDocument;
  // In accessible-name order, so the first non-empty one is the name.
  const texts = [
    element.getAttribute('aria-label') ?? '',
    (element.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .map((id) => (id === '' ? '' : (ownerDocument.getElementById(id)?.textContent ?? '')))
      .join(' '),
    text,
    element.getAttribute('alt') ?? '',
    Array.from(element.querySelectorAll('img[alt]'), (image) => image.getAttribute('alt') ?? '').join(' '),
    Array.from(element.labels ?? [], (label) => label.textContent ?? '').join(' '),
    element.getAttribute('title') ?? '',
  ]
    .map((candidate) => candidate.replace(/\s+/g, ' ').trim().slice(0, 200))
    .filter((candidate) => candidate !== '');
  const name = texts[0] ?? '';
  let destination: string | undefined;
  if (tag === 'a' && element.getAttribute('href') !== null) destination = element.href;
  else if (buttonLike && type !== 'reset' && type !== 'button' && element.form) {
    destination = element.getAttribute('formaction') === null ? element.form.action : element.formAction;
  }
  const info: ElementInfo = { role, name, texts, frameUrl: ownerDocument.location.href };
  return destination === undefined ? info : { ...info, destination };
}

type InspectedElement = {
  readonly tagName: string;
  readonly textContent: string | null;
  readonly parentElement: InspectedElement | null;
  readonly previousElementSibling: InspectedElement | null;
  readonly cellIndex?: number;
  readonly cells?: ArrayLike<InspectedElement>;
  readonly rows?: ArrayLike<InspectedElement>;
  getAttribute(name: string): string | null;
  closest(selectors: string): InspectedElement | null;
  querySelector(selectors: string): InspectedElement | null;
};

// Runs inside the page, same constraints as elementInfo. The label and header rules mirror
// the `label` and `table_cell` locators, so what is described here can be located again.
function elementDescriptor(element: InspectedElement): ElementDescriptor {
  const attributes: { name?: string; id?: string } = {};
  const nameAttribute = element.getAttribute('name');
  if (nameAttribute !== null && nameAttribute !== '') attributes.name = nameAttribute;
  const idAttribute = element.getAttribute('id');
  if (idAttribute !== null && idAttribute !== '') attributes.id = idAttribute;

  const cell = element.closest('td, th');
  const row = cell?.parentElement ?? null;
  const table = row?.closest('table') ?? null;
  if (cell === null || row === null || table === null) return { attributes };

  const tag = element.tagName.toLowerCase();
  const type = (element.getAttribute('type') ?? 'text').toLowerCase();
  const valueControl =
    tag === 'select' || tag === 'textarea' || (tag === 'input' && !['hidden', 'submit', 'button', 'image', 'reset'].includes(type));
  const valueCell = tag === 'td' && element.querySelector('input, select, textarea, a, button') === null;
  const label = valueControl || valueCell ? (cell.previousElementSibling?.textContent ?? '').replace(/\s+/g, ' ').trim() : '';

  let position: { column: string; row: Record<string, string> } | undefined;
  const header = table.rows?.[0];
  if (header !== undefined && header !== row && cell.cellIndex !== undefined) {
    const headers = Array.from(header.cells ?? [], (headerCell) => (headerCell.textContent ?? '').replace(/\s+/g, ' ').trim());
    const column = headers[cell.cellIndex] ?? '';
    if (column !== '') {
      const texts: Record<string, string> = {};
      Array.from(row.cells ?? []).forEach((rowCell, index) => {
        const heading = headers[index] ?? '';
        if (heading !== '') texts[heading] = (rowCell.textContent ?? '').replace(/\s+/g, ' ').trim();
      });
      position = { column, row: texts };
    }
  }
  return { attributes, ...(label === '' ? {} : { label }), ...(position === undefined ? {} : { cell: position }) };
}

// Abandons loads still in flight after a timeout, so a retried action starts a fresh request
// instead of joining the one that timed out.
async function stopLoading(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    await frame.evaluate('window.stop()').catch(() => undefined);
  }
}

function frameName(frame: Frame): string | null {
  return frame.parentFrame() === null ? null : frame.name();
}

// Origin and path: a query string may carry what the human typed.
function withoutQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'null' ? `${parsed.protocol}${parsed.pathname}` : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '';
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof errors.TimeoutError;
}

function failure(error: unknown): PerformOutcome {
  if (isTimeout(error)) return { status: 'timeout' };
  return { status: 'error', message: error instanceof Error ? error.message.split('\n')[0] : String(error) };
}

export function createPlaywrightDriver(options: PlaywrightDriverOptions = {}): PlaywrightDriver {
  const headless = options.headless ?? true;
  let surface: Surface | undefined;
  let refTargets: ReadonlyMap<string, string> = new Map();
  let resolvedTargets = new Map<string, Locator>();
  let observations = 0;
  let capture: HumanCaptureListener | undefined;
  let humanEvents = 0;
  let navigationGuard: ((url: string) => boolean) | undefined;
  // A dialog automation dismissed, shown in the next observation.
  let dismissedDialog: Dialog | undefined;
  let closed = false;
  const closedCallbacks = new Set<() => void>();

  function report(payload: unknown): void {
    if (capture === undefined || humanEvents >= MAX_HUMAN_EVENTS) return;
    const parsed = HumanActionSchema.safeParse(payload);
    if (!parsed.success) return;
    humanEvents += 1;
    capture.onAction(parsed.data);
  }

  async function prepare(context: BrowserContext): Promise<void> {
    await context.route('**/*', (route, request) =>
      request.isNavigationRequest() && navigationGuard !== undefined && !navigationGuard(request.url())
        ? route.abort('blockedbyclient')
        : route.continue(),
    );
    await context.exposeBinding(HUMAN_EVENT_BINDING, ({ frame }, payload: unknown) => {
      if (capture === undefined || typeof payload !== 'object' || payload === null) return;
      const event = payload as { target?: object };
      report({ ...event, target: { ...event.target, frame: frameName(frame) }, at: new Date().toISOString() });
    });
    await context.addInitScript({ content: HUMAN_CAPTURE_SCRIPT });
  }

  async function answer(dialog: PageDialog): Promise<void> {
    const shown: Dialog = { type: dialog.type() as Dialog['type'], message: dialog.message() };
    const listener = capture;
    let decision: DialogDecision = 'dismiss';
    if (listener === undefined) dismissedDialog = shown;
    else decision = await listener.onDialog(shown).catch((): DialogDecision => 'dismiss');
    // The operator may also have answered it in the window.
    await (decision === 'accept' ? dialog.accept() : dialog.dismiss()).catch(() => undefined);
  }

  function markClosed(): void {
    if (closed) return;
    closed = true;
    for (const callback of closedCallbacks) callback();
    closedCallbacks.clear();
  }

  function watch({ browser, context, page }: Surface): void {
    // One page per run: a popup would be a second page outside what is observed and policed.
    context.on('page', (popup) => {
      if (popup !== page) void popup.close().catch(() => undefined);
    });
    page.on('dialog', (dialog) => void answer(dialog));
    page.on('framenavigated', (frame) => {
      if (capture !== undefined) report({ kind: 'navigation', frame: frameName(frame), url: withoutQuery(frame.url()), at: new Date().toISOString() });
    });
    page.on('close', markClosed);
    browser.on('disconnected', markClosed);
  }

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
      if (surface === undefined) {
        surface = await launch(headless, prepare);
        closed = false;
        watch(surface);
      }
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
      const dialog = dismissedDialog ?? null;
      dismissedDialog = undefined;
      return { ...result.observation, dialog };
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

    async inspect(ref) {
      const { page } = current();
      return locate(page, ref).evaluate(elementDescriptor, undefined, { timeout: ACTION_TIMEOUT_MS });
    },

    currentUrl() {
      return current().page.url();
    },

    frameUrls() {
      const { page } = current();
      return [page.url(), ...page.frames().filter((frame) => frame !== page.mainFrame()).map((frame) => frame.url())];
    },

    setNavigationGuard(allows) {
      navigationGuard = allows;
    },

    async screenshot() {
      return current().page.screenshot({ fullPage: true, timeout: ACTION_TIMEOUT_MS });
    },

    startHumanCapture(listener) {
      capture = listener;
      humanEvents = 0;
    },

    stopHumanCapture() {
      capture = undefined;
    },

    onClosed(callback) {
      if (closed) {
        queueMicrotask(callback);
        return () => undefined;
      }
      closedCallbacks.add(callback);
      return () => closedCallbacks.delete(callback);
    },

    page() {
      return current().page;
    },

    async close() {
      const closing = surface;
      surface = undefined;
      capture = undefined;
      closedCallbacks.clear();
      resetRefs();
      await closing?.browser.close();
    },
  };
}

function argumentOf(action: Action): string {
  if (action.argument === null) throw new SurfaceError('unsupported_action', `${action.verb} needs an argument`);
  return action.argument;
}
