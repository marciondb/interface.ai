import type { Dialog as PageDialog, Frame } from 'playwright';
import { HumanActionSchema, type DialogDecision } from '../../models/intervention';
import type { Dialog } from '../../models/observation';
import type { HumanCaptureListener } from './port';

// Human reports kept per capture; the rest are dropped.
const MAX_HUMAN_EVENTS = 200;

export type HumanCapture = {
  start(listener: HumanCaptureListener): void;
  stop(): void;
  // A report the capture script posted from frame.
  fromPage(frame: Frame, payload: unknown): void;
  navigated(frame: Frame): void;
  // Outside a capture the dialog is dismissed and kept for the next observation; during one
  // the listener decides.
  answer(dialog: PageDialog): Promise<void>;
  // The dialog dismissed since the last call, if any.
  takeDismissedDialog(): Dialog | null;
};

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

export function createHumanCapture(): HumanCapture {
  let listener: HumanCaptureListener | undefined;
  let reported = 0;
  let dismissed: Dialog | undefined;

  function report(payload: unknown): void {
    if (listener === undefined || reported >= MAX_HUMAN_EVENTS) return;
    const parsed = HumanActionSchema.safeParse(payload);
    if (!parsed.success) return;
    reported += 1;
    listener.onAction(parsed.data);
  }

  return {
    start(next) {
      listener = next;
      reported = 0;
    },

    stop() {
      listener = undefined;
    },

    fromPage(frame, payload) {
      if (listener === undefined || typeof payload !== 'object' || payload === null) return;
      const event = payload as { target?: object };
      report({ ...event, target: { ...event.target, frame: frameName(frame) }, at: new Date().toISOString() });
    },

    navigated(frame) {
      if (listener !== undefined) report({ kind: 'navigation', frame: frameName(frame), url: withoutQuery(frame.url()), at: new Date().toISOString() });
    },

    async answer(dialog) {
      const shown: Dialog = { type: dialog.type() as Dialog['type'], message: dialog.message() };
      const current = listener;
      let decision: DialogDecision = 'dismiss';
      if (current === undefined) dismissed = shown;
      else decision = await current.onDialog(shown).catch((): DialogDecision => 'dismiss');
      // The operator may also have answered it in the window.
      await (decision === 'accept' ? dialog.accept() : dialog.dismiss()).catch(() => undefined);
    },

    takeDismissedDialog() {
      const taken = dismissed ?? null;
      dismissed = undefined;
      return taken;
    },
  };
}
