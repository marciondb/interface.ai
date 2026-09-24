import type { Page } from 'playwright';
import { performAction } from './actions';
import { createBrowserSession } from './browser-session';
import { createHumanCapture } from './human-capture';
import { ELEMENT_DESCRIPTOR_SCRIPT } from './in-page/element-descriptor';
import { ELEMENT_INFO_SCRIPT } from './in-page/element-info';
import { HUMAN_CAPTURE_SCRIPT, HUMAN_EVENT_BINDING } from './in-page/human-capture-script';
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
    async open(url, cookies) {
      refs.clear();
      await session.open(url, cookies);
    },

    async observe() {
      const page = session.page();
      refs.clear();
      const { observation, refTargets } = await snapshotPage(page, observations + 1);
      observations += 1;
      refs.replace(refTargets);
      return { ...observation, dialog: capture.takeDismissedDialog() };
    },

    async resolve(target) {
      return resolveTarget(session.page(), target, (locator) => refs.mint(locator));
    },

    async perform(action, performOptions) {
      return performAction(session.page(), action, locate, performOptions?.timeoutMs ?? ACTION_TIMEOUT_MS);
    },

    async describe(ref) {
      return locate(ref).evaluate(ELEMENT_INFO_SCRIPT, undefined, { timeout: ACTION_TIMEOUT_MS });
    },

    async inspect(ref) {
      return locate(ref).evaluate(ELEMENT_DESCRIPTOR_SCRIPT, undefined, { timeout: ACTION_TIMEOUT_MS });
    },

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

    async screenshot(screenshotOptions) {
      return takeScreenshot(session.page(), screenshotOptions?.maskTexts ?? [], ACTION_TIMEOUT_MS);
    },

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
