import { describe, expect, it } from 'vitest';
import { createEscalationController, type HandoffRequest } from '../../../src/controllers/escalation';
import type { EscalationBroker, OperatorCommand } from '../../../src/diplomat/escalation/port';
import type { HumanSurface, ScreenshotOptions } from '../../../src/diplomat/surface/port';
import { createFakeClock, createFakeEvidence, type FakeEvidence } from '../../support/fakes';
import { emptyObservation } from '../../support/observations';

type FakeWindow = HumanSurface & {
  readonly screenshots: (ScreenshotOptions | undefined)[];
  capturing: boolean;
  subscribed: boolean;
};

function fakeWindow(): FakeWindow {
  const window: FakeWindow = {
    screenshots: [],
    capturing: false,
    subscribed: false,
    observe: () => Promise.resolve(emptyObservation()),
    screenshot(options) {
      window.screenshots.push(options);
      return Promise.resolve(new Uint8Array([137, 80, 78, 71]));
    },
    currentUrl: () => 'http://app.test/',
    startHumanCapture() {
      window.capturing = true;
    },
    stopHumanCapture() {
      window.capturing = false;
    },
    onClosed() {
      window.subscribed = true;
      return () => {
        window.subscribed = false;
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
});
