import { chromium, type Browser, type BrowserContext, type Dialog, type Frame, type Page } from 'playwright';
import type { SessionCookie } from '../session/port';
import { SurfaceError } from './errors';

export type BrowserSessionOptions = {
  readonly headless: boolean;
  // Installed in every document of the context, frames included.
  readonly initScript: string;
  // A function the init script calls to report to the driver.
  readonly binding: { readonly name: string; readonly onCall: (frame: Frame, payload: unknown) => void };
  readonly onDialog: (dialog: Dialog) => void;
  readonly onFrameNavigated: (frame: Frame) => void;
};

// One browser, one context, one page per run.
export type BrowserSession = {
  // Launches the browser on first use, then loads url on the same page with the cookies added.
  open(url: string, cookies: readonly SessionCookie[]): Promise<void>;
  // Rejects with not_open before the first open().
  page(): Page;
  // Navigations of the page or any frame to a URL allows rejects are aborted before the
  // request is sent, whoever starts them.
  setNavigationGuard(allows: (url: string) => boolean): void;
  // Called once when the page is closed or the browser goes away; returns an unsubscribe.
  onClosed(callback: () => void): () => void;
  close(): Promise<void>;
};

type Surface = {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
};

export function createBrowserSession(options: BrowserSessionOptions): BrowserSession {
  let surface: Surface | undefined;
  let navigationGuard: ((url: string) => boolean) | undefined;
  let closed = false;
  const closedCallbacks = new Set<() => void>();

  async function prepare(context: BrowserContext): Promise<void> {
    await context.route('**/*', (route, request) =>
      request.isNavigationRequest() && navigationGuard !== undefined && !navigationGuard(request.url())
        ? route.abort('blockedbyclient')
        : route.continue(),
    );
    await context.exposeBinding(options.binding.name, ({ frame }, payload: unknown) => {
      options.binding.onCall(frame, payload);
    });
    await context.addInitScript({ content: options.initScript });
  }

  async function launch(): Promise<Surface> {
    const browser = await chromium.launch({ headless: options.headless });
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

  function markClosed(): void {
    if (closed) return;
    closed = true;
    for (const callback of closedCallbacks) callback();
    closedCallbacks.clear();
  }

  function watch({ browser, context, page }: Surface): void {
    // A popup would be a second page outside what is observed and policed.
    context.on('page', (popup) => {
      if (popup !== page) void popup.close().catch(() => undefined);
    });
    page.on('dialog', options.onDialog);
    page.on('framenavigated', options.onFrameNavigated);
    page.on('close', markClosed);
    browser.on('disconnected', markClosed);
  }

  return {
    async open(url, cookies) {
      if (surface === undefined) {
        surface = await launch();
        closed = false;
        watch(surface);
      }
      const origin = new URL(url).origin;
      await surface.context.addCookies(cookies.map((cookie) => ({ name: cookie.name, value: cookie.value, url: origin })));
      await surface.page.goto(url, { waitUntil: 'load' });
    },

    page() {
      if (surface === undefined) throw new SurfaceError('not_open', 'open() has not been called');
      return surface.page;
    },

    setNavigationGuard(allows) {
      navigationGuard = allows;
    },

    onClosed(callback) {
      if (closed) {
        queueMicrotask(callback);
        return () => undefined;
      }
      closedCallbacks.add(callback);
      return () => closedCallbacks.delete(callback);
    },

    async close() {
      const closing = surface;
      surface = undefined;
      closedCallbacks.clear();
      await closing?.browser.close();
    },
  };
}
