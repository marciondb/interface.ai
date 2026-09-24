import { describe, expect, it } from 'vitest';
import { createEscalationController, type HandoffRequest } from '../../../src/controllers/escalation';
import type { EscalationBroker, OperatorCommand } from '../../../src/diplomat/escalation/port';
import type { HumanCaptureListener, HumanSurface, ScreenshotOptions } from '../../../src/diplomat/surface/port';
import type { Verification } from '../../../src/models/intervention';
import { createFakeClock, createFakeEvidence, type FakeEvidence } from '../../support/fakes';
import { emptyObservation } from '../../support/observations';

type FakeWindow = HumanSurface & {
  readonly screenshots: (ScreenshotOptions | undefined)[];
  capturing: boolean;
  subscribed: boolean;
  listener: HumanCaptureListener | undefined;
  close(): void;
};

function fakeWindow(): FakeWindow {
  let closed: (() => void) | undefined;
  const window: FakeWindow = {
    screenshots: [],
    capturing: false,
    subscribed: false,
    listener: undefined,
    close() {
      closed?.();
    },
    observe: () => Promise.resolve(emptyObservation()),
    screenshot(options) {
      window.screenshots.push(options);
      return Promise.resolve(new Uint8Array([137, 80, 78, 71]));
    },
    currentUrl: () => 'http://app.test/',
    startHumanCapture(listener) {
      window.capturing = true;
      window.listener = listener;
    },
    stopHumanCapture() {
      window.capturing = false;
    },
    onClosed(callback) {
      window.subscribed = true;
      closed = callback;
      return () => {
        window.subscribed = false;
        closed = undefined;
      };
    },
  };
  return window;
}

type FakeBroker = EscalationBroker & { readonly shown: unknown[] };

// Types the given commands, one per prompt, and keeps what it was asked to show.
function fakeBroker(commands: readonly OperatorCommand[]): FakeBroker {
  const queue = [...commands];
  const shown: unknown[] = [];
  return {
    shown,
    publish: (request) => {
      shown.push(request);
    },
    nextCommand: () => Promise.resolve(queue.shift() ?? 'timeout'),
    askDialog: () => Promise.resolve('dismiss'),
    notify: (text) => {
      shown.push(text);
    },
    close: () => undefined,
  };
}

function request(): HandoffRequest {
  return {
    run: { runId: 'run-1', dir: '/evidence/run-1' },
    mode: 'replay',
    stepId: 'confirm',
    reason: 'risky_action',
    message: 'confirm needs a human',
    verify: () => Promise.resolve({ held: true }),
    maskTexts: ['10001'],
  };
}

function controller(evidence: FakeEvidence, window: FakeWindow, commands: readonly OperatorCommand[], broker = fakeBroker(commands)) {
  return createEscalationController(
    { surface: window, broker, evidence, clock: createFakeClock() },
    { ttlMs: 30_000, humanSurfaceAvailable: true, operatorId: 'test-operator' },
  );
}

describe('escalation controller when the handoff itself breaks', () => {
  it('shows the operator only redacted text', async () => {
    const evidence: FakeEvidence = { ...createFakeEvidence(), redact: <T>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll('10001', '[REDACTED]')) as T };
    const broker = fakeBroker(['abort']);
    const escalation = controller(evidence, fakeWindow(), [], broker);

    await escalation.handOff({ ...request(), goal: 'Look up member 10001', message: 'confirm for 10001 needs a human' });
    expect(JSON.stringify(broker.shown)).not.toContain('10001');
    expect(broker.shown[0]).toMatchObject({ goal: 'Look up member [REDACTED]', message: 'confirm for [REDACTED] needs a human' });
  });

  it('masks the protected values in the handoff screenshots', async () => {
    const evidence = createFakeEvidence();
    const window = fakeWindow();
    const escalation = controller(evidence, window, ['take', 'resume']);

    await expect(escalation.handOff(request())).resolves.toMatchObject({ status: 'resumed' });
    expect(window.screenshots).toEqual([{ maskTexts: ['10001'] }, { maskTexts: ['10001'] }]);
    expect(escalation.owner()).toBe('automation');
  });

  it('leaves nobody in control when the request cannot be written', async () => {
    const evidence = createFakeEvidence();
    evidence.intervention = () => Promise.reject(new Error('EACCES: permission denied'));
    const window = fakeWindow();
    const escalation = controller(evidence, window, ['take', 'resume']);

    await expect(escalation.handOff(request())).rejects.toThrow('EACCES');
    expect(escalation.owner()).toBe('human');
    await expect(escalation.handOff(request())).rejects.toThrow('control: escalate is not valid while aborted');
  });

  it('stops the human capture and the window listener when recording fails mid-handoff', async () => {
    const evidence = createFakeEvidence();
    const record = evidence.event.bind(evidence);
    evidence.event = (event) => (event.type === 'handoff_taken' ? Promise.reject(new Error('ENOSPC: no space left on device')) : record(event));
    const window = fakeWindow();
    const escalation = controller(evidence, window, ['take', 'resume']);

    await expect(escalation.handOff(request())).rejects.toThrow('ENOSPC');
    expect(window.capturing).toBe(false);
    expect(window.subscribed).toBe(false);
    expect(escalation.owner()).toBe('human');
  });

  it('stops checking the human work, and records nothing after, when the window closes mid-check', async () => {
    const evidence = createFakeEvidence();
    const window = fakeWindow();
    const escalation = controller(evidence, window, ['take', 'resume']);
    let checkSignal: AbortSignal | undefined;
    const verify = (signal: AbortSignal) =>
      new Promise<Verification>((resolve) => {
        checkSignal = signal;
        signal.addEventListener('abort', () => {
          resolve({ held: false, expected: 'the operator window to stay open', observed: 'it was closed' });
        });
        window.close();
      });

    await expect(escalation.handOff({ ...request(), verify })).resolves.toMatchObject({ status: 'aborted', cause: 'surface_closed' });
    expect(checkSignal?.aborted).toBe(true);
    expect(evidence.events.at(-1)).toMatchObject({ type: 'handoff_aborted', cause: 'surface_closed' });
  });

  it('fails the handoff with the write error when a human action cannot be recorded while the operator works', async () => {
    const evidence = createFakeEvidence();
    const record = evidence.event.bind(evidence);
    evidence.event = (event) => (event.type === 'handoff_human_action' ? Promise.reject(new Error('ENOSPC: no space left on device')) : record(event));
    const window = fakeWindow();
    const broker = fakeBroker([]);
    let prompts = 0;
    broker.nextCommand = () => {
      prompts += 1;
      if (prompts === 1) return Promise.resolve('take');
      // The operator clicks while in control; resume comes a moment later.
      window.listener?.onAction({ kind: 'click', target: { frame: 'content', tag: 'input', role: 'button', name: 'Confirm' }, at: '2026-09-24T21:54:32.000Z' });
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve('resume');
        }, 20);
      });
    };
    const escalation = controller(evidence, window, [], broker);

    await expect(escalation.handOff(request())).rejects.toThrow('ENOSPC');
    expect(window.capturing).toBe(false);
  });
});
