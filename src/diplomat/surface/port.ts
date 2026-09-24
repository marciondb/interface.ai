import type { SurfaceAction } from '../../models/action';
import type { TargetSpec } from '../../models/capability';
import type { ElementDescriptor } from '../../models/element-descriptor';
import type { DialogDecision, HumanAction } from '../../models/intervention';
import type { Dialog, Observation } from '../../models/observation';
import type { ElementInfo, PerformOutcome, Resolution } from '../../models/resolution';
import type { SessionCookie } from '../session/port';

// timeout: the page did not answer in time, or a frame was replaced while it was being read.
// driver_error: the surface failed in a way that is neither a page outcome nor an absence.
// invalid_candidate: a locator candidate the surface cannot express (e.g. an unknown role).
export const SURFACE_ERROR_CODES = ['not_open', 'unknown_ref', 'snapshot_mismatch', 'timeout', 'driver_error', 'invalid_candidate'] as const;
export type SurfaceErrorCode = (typeof SURFACE_ERROR_CODES)[number];

export type SurfaceFault = Error & { readonly name: 'SurfaceError'; readonly code: SurfaceErrorCode };

export function isSurfaceError(error: unknown): error is SurfaceFault {
  return error instanceof Error && error.name === 'SurfaceError' && 'code' in error && (SURFACE_ERROR_CODES as readonly unknown[]).includes(error.code);
}

export type PerformOptions = {
  // Budget for the action and for the navigations it starts to finish loading (default 5000).
  readonly timeoutMs?: number;
};

export type ScreenshotOptions = {
  // Elements, in any frame, whose visible text or field value contains one of these (exact,
  // case-sensitive substring) are covered by a solid box. Empty strings are ignored.
  readonly maskTexts?: readonly string[];
};

// One browser, one context, one page per run. Methods reject only with a SurfaceFault; anything
// else they throw is a bug.
export type SurfaceDriver = {
  // Loads url with the session cookies; calling it again reuses the same page (re-login).
  open(url: string, session: readonly SessionCookie[]): Promise<void>;
  // Unredacted; refs are valid only until the next observe().
  observe(): Promise<Observation>;
  // Tries the candidates in order; the first with exactly one match gets a ref (ADR-008),
  // valid until the next observe().
  resolve(target: TargetSpec): Promise<Resolution>;
  // action.ref must be from the latest observe() or a later resolve(). A read resolves to done
  // with the value. Page failures are outcomes; only misuse (unknown ref) rejects.
  perform(action: SurfaceAction, options?: PerformOptions): Promise<PerformOutcome>;
  describe(ref: string): Promise<ElementInfo>;
  // The element's attributes, adjacent label and table position, for building locators (discovery).
  inspect(ref: string): Promise<ElementDescriptor>;
  currentUrl(): string;
  // The page URL, then the URL of every frame in it.
  frameUrls(): readonly string[];
  // From now on, navigations of the page or any frame to a URL `allows` rejects are aborted
  // before the request is sent, whoever starts them. Popups are always closed.
  setNavigationGuard(allows: (url: string) => boolean): void;
  // PNG of the full page.
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>;
  close(): Promise<void>;
};

export type HumanCaptureListener = {
  // Clicks, changed fields (value masked in the page) and frame navigations.
  onAction(action: HumanAction): void;
  // A native dialog raised while a human holds control; the answer is applied to it.
  onDialog(dialog: Dialog): Promise<DialogDecision>;
};

// The live window a human works in during a handoff (ADR-012). It offers no way to act on the
// page: automation acts only through the gateway.
export type HumanSurface = {
  observe(): Promise<Observation>;
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>;
  currentUrl(): string;
  // Until stopHumanCapture(), what happens on the page is reported as human, up to a cap per
  // capture (page scripts can post reports too). Outside a capture, dialogs are dismissed and
  // shown in the next observation.
  startHumanCapture(listener: HumanCaptureListener): void;
  stopHumanCapture(): void;
  // Called once when the window is closed or the browser goes away; returns an unsubscribe.
  onClosed(callback: () => void): () => void;
};
