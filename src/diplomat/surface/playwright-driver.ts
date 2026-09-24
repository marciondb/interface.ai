import type { Page } from 'playwright';
import { performAction } from './actions';
import { createBrowserSession } from './browser-session';
import { createHumanCapture } from './human-capture';
import { ELEMENT_DESCRIPTOR_SCRIPT } from './in-page/element-descriptor';
import { ELEMENT_INFO_SCRIPT } from './in-page/element-info';
import { HUMAN_CAPTURE_SCRIPT, HUMAN_EVENT_BINDING } from './in-page/human-capture-script';
import { translated } from './playwright-errors';
import type { HumanSurface, SurfaceDriver } from './port';
import { createRefRegistry } from './ref-registry';
import { resolveTarget } from './resolve';
import { takeScreenshot } from './screenshot';
import { snapshotPage } from './snapshot';

const ACTION_TIMEOUT_MS = 5_000;

export type PlaywrightDriverOptions = {
  readonly headless?: boolean;
  // Adds page(), for tests that play the human operator on the live page.
  readonly exposePageForTests?: boolean;
};

export type PlaywrightDriver = SurfaceDriver & HumanSurface;

export type PlaywrightTestDriver = PlaywrightDriver & { page(): Page };

export function createPlaywrightDriver(options: PlaywrightDriverOptions & { readonly exposePageForTests: true }): PlaywrightTestDriver;
export function createPlaywrightDriver(options?: PlaywrightDriverOptions): PlaywrightDriver;
export function createPlaywrightDriver(options: PlaywrightDriverOptions = {}): PlaywrightDriver | PlaywrightTestDriver {
  const capture = createHumanCapture();
  const refs = createRefRegistry();
  const session = createBrowserSession({
    headless: options.headless ?? true,
    initScript: HUMAN_CAPTURE_SCRIPT,
    binding: {
      name: HUMAN_EVENT_BINDING,
      onCall: (frame, payload) => {
        capture.fromPage(frame, payload);
      },
    },
    onDialog: (dialog) => {
      void capture.answer(dialog);
    },
    onFrameNavigated: (frame) => {
      capture.navigated(frame);
    },
  });
  let observations = 0;

  const locate = (ref: string) => refs.locate(session.page(), ref);

  const driver: PlaywrightDriver = {
    open: (url, cookies) =>
      translated(async () => {
        refs.clear();
        await session.open(url, cookies);
      }),

    observe: () =>
      translated(async () => {
        const page = session.page();
        refs.clear();
        const { observation, refTargets } = await snapshotPage(page, observations + 1);
        observations += 1;
        refs.replace(refTargets);
        return { ...observation, dialog: capture.takeDismissedDialog() };
      }),

    resolve: (target) => translated(() => resolveTarget(session.page(), target, (locator) => refs.mint(locator))),

    perform: (action, performOptions) =>
      translated(() => performAction(session.page(), action, locate, performOptions?.timeoutMs ?? ACTION_TIMEOUT_MS)),

    describe: (ref) => translated(() => locate(ref).evaluate(ELEMENT_INFO_SCRIPT, undefined, { timeout: ACTION_TIMEOUT_MS })),

    inspect: (ref) => translated(() => locate(ref).evaluate(ELEMENT_DESCRIPTOR_SCRIPT, undefined, { timeout: ACTION_TIMEOUT_MS })),

    currentUrl() {
      return session.page().url();
    },

    frameUrls() {
      const page = session.page();
      return [page.url(), ...page.frames().filter((frame) => frame !== page.mainFrame()).map((frame) => frame.url())];
    },

    setNavigationGuard(allows) {
      session.setNavigationGuard(allows);
    },

    screenshot: (screenshotOptions) => translated(() => takeScreenshot(session.page(), screenshotOptions?.maskTexts ?? [], ACTION_TIMEOUT_MS)),

    startHumanCapture(listener) {
      capture.start(listener);
    },

    stopHumanCapture() {
      capture.stop();
    },

    onClosed(callback) {
      return session.onClosed(callback);
    },

    async close() {
      capture.stop();
      refs.clear();
      await session.close();
    },
  };
  return options.exposePageForTests === true ? { ...driver, page: () => session.page() } : driver;
}
