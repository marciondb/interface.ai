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

// Types the given commands, one per prompt.
function fakeBroker(commands: readonly OperatorCommand[]): EscalationBroker {
  const queue = [...commands];
  return {
    publish: () => undefined,
    nextCommand: () => Promise.resolve(queue.shift() ?? 'timeout'),
    askDialog: () => Promise.resolve('dismiss'),
    notify: () => undefined,
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

function controller(evidence: FakeEvidence, window: FakeWindow, commands: readonly OperatorCommand[]) {
  return createEscalationController(
    { surface: window, broker: fakeBroker(commands), evidence, clock: createFakeClock() },
    { ttlMs: 30_000, humanSurfaceAvailable: true, operatorId: 'test-operator' },
  );
}

describe('escalation controller when the handoff itself breaks', () => {
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
