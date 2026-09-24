import type { EscalationBroker, OperatorCommand } from '../diplomat/escalation/port';
import type { EvidenceRecorder, EvidenceRun } from '../diplomat/evidence/port';
import type { HumanSurface } from '../diplomat/surface/port';
import type { Clock } from '../infrastructure/clock';
import { errorMessage } from '../infrastructure/errors';
import { newId } from '../infrastructure/ids';
import { ownerOf, transition } from '../logic/control';
import type { ControlEvent, ControlOwner, ControlState } from '../models/control';
import type { EscalationReason } from '../models/execution-result';
import type { DialogDecision, HandoffOutcome, HumanAction, InterventionReason, InterventionRequest, Verification } from '../models/intervention';
import type { Observation } from '../models/observation';
import type { RunMode } from '../models/run-event';

export type { Verification } from '../models/intervention';

export type EscalationDeps = {
  readonly surface: HumanSurface;
  readonly broker: EscalationBroker;
  readonly evidence: EvidenceRecorder;
  readonly clock: Clock;
};

export type EscalationOptions = {
  readonly ttlMs: number;
  // A window the operator can work in (--headed); without one every handoff ends at once.
  readonly humanSurfaceAvailable: boolean;
  // Recorded as who resumed or aborted; never the OS user (evidence is shareable).
  readonly operatorId: string;
};

export type HandoffRequest = {
  readonly run: EvidenceRun;
  readonly mode: RunMode;
  // `id@version`.
  readonly capability?: string;
  readonly goal?: string;
  readonly stepId: string;
  readonly reason: InterventionReason;
  readonly message: string;
  // Re-observes the page and checks the human's work; their word is not taken on faith.
  readonly verify: () => Promise<Verification>;
  // The run's protected values, covered in the handoff screenshots.
  readonly maskTexts: readonly string[];
};

// Holds the control owner of the live session (ADR-012) and runs each handoff (RFC-005).
export type Escalation = {
  readonly owner: () => ControlOwner;
  // Whether a handoff can reach a human at all; without an operator window it ends at once.
  readonly humanSurfaceAvailable: boolean;
  readonly handOff: (request: HandoffRequest) => Promise<HandoffOutcome>;
};

const ABORT_EVENTS: Record<EscalationReason, ControlEvent> = {
  aborted: 'operator_abort',
  ttl_expired: 'ttl_expired',
  surface_closed: 'surface_closed',
  no_operator_surface: 'no_operator_surface',
};

// The innermost document is what the operator is looking at (the fixture keeps its top URL fixed).
function visibleUrl(observation: Observation | undefined, fallback: string): string {
  return observation?.frames.at(-1)?.url ?? fallback;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function createEscalationController(deps: EscalationDeps, options: EscalationOptions): Escalation {
  const { surface, broker, evidence, clock } = deps;

  function tell(text: string): void {
    broker.notify(evidence.redact(text));
  }
  let state: ControlState = 'automation';

  function move(event: ControlEvent): void {
    const moved = transition(state, event);
    if (!moved.ok) throw new Error(`control: ${moved.reason}`);
    state = moved.state;
  }

  // Best effort: a closed window still gets its handoff recorded.
  async function capture(name: string, maskTexts: readonly string[]): Promise<{ observation?: Observation; screenshot?: string }> {
    let observation: Observation | undefined;
    let screenshot: Uint8Array | undefined;
    try {
      observation = await surface.observe();
      screenshot = await surface.screenshot({ maskTexts });
    } catch {
      // Recorded without the picture.
    }
    const paths = await evidence.capture(name, { screenshot, snapshot: observation });
    return { observation, screenshot: paths.screenshot };
  }

  // Writes intervention.json and its event, and shows the request to the operator.
  async function publish(request: HandoffRequest, interventionId: string, requestedAt: number, expiresAt: number): Promise<void> {
    const { run, stepId } = request;
    const before = await capture(`handoff-${interventionId}-before`, request.maskTexts);
    const screenshot = before.screenshot ?? null;
    let url = '';
    try {
      url = surface.currentUrl();
    } catch {
      // Not open.
    }
    const intervention: InterventionRequest = {
      interventionId,
      runId: run.runId,
      mode: request.mode,
      ...(request.capability === undefined ? {} : { capability: request.capability }),
      ...(request.goal === undefined ? {} : { goal: request.goal }),
      stepId,
      reason: request.reason,
      message: request.message,
      screenshot,
      url: visibleUrl(before.observation, url),
      requestedAt: iso(requestedAt),
      expiresAt: iso(expiresAt),
    };
    await evidence.intervention(intervention);
    await evidence.event({ type: 'handoff_requested', stepId, interventionId, reason: request.reason, message: request.message, expiresAt: intervention.expiresAt });
    // The terminal gets the same redacted request as intervention.json.
    broker.publish(evidence.redact(intervention));
  }

  async function verifyWork(request: HandoffRequest): Promise<Verification> {
    try {
      return await request.verify();
    } catch (error) {
      return { held: false, expected: 'the page to be readable', observed: errorMessage(error) };
    }
  }

  async function runHandoff(request: HandoffRequest): Promise<HandoffOutcome> {
    const { stepId, maskTexts } = request;
    const interventionId = newId('int');
    const requestedAt = clock.now();
    const expiresAt = requestedAt + options.ttlMs;
    await publish(request, interventionId, requestedAt, expiresAt);

    const actions: HumanAction[] = [];
    let recorded = Promise.resolve();
    function record(action: HumanAction): void {
      actions.push(action);
      recorded = recorded.then(() => evidence.event({ type: 'handoff_human_action', stepId, interventionId, action }));
    }

    async function abort(cause: EscalationReason, by?: string): Promise<HandoffOutcome> {
      move(ABORT_EVENTS[cause]);
      await recorded;
      if (cause !== 'surface_closed' && cause !== 'no_operator_surface') await capture(`handoff-${interventionId}-after`, maskTexts);
      await evidence.event({ type: 'handoff_aborted', stepId, interventionId, cause, ...(by === undefined ? {} : { by }) });
      tell(`Handoff ${interventionId} ended: ${cause}. The run ends as escalated.`);
      return { status: 'aborted', interventionId, cause, at: iso(clock.now()), actions };
    }

    if (!options.humanSurfaceAvailable) {
      tell('No operator window is available: run with --headed to take over the session.');
      return abort('no_operator_surface');
    }

    const waits = new AbortController();
    let unsubscribe: () => void = () => undefined;
    // Raced against every wait below, and listed first: a window closed while the operator typed
    // a command, or while their work was being checked, ends the handoff.
    const windowClosed = new Promise<'closed'>((resolve) => {
      unsubscribe = surface.onClosed(() => {
        resolve('closed');
        waits.abort();
      });
    });
    const waitOptions = { expiresAt, signal: waits.signal };
    try {
      surface.startHumanCapture({
        onAction: record,
        async onDialog(dialog) {
          const answer = await broker.askDialog(evidence.redact(dialog), waitOptions);
          const decision: DialogDecision = answer === 'timeout' ? 'dismiss' : answer;
          record({ kind: 'dialog', message: dialog.message, decision, at: iso(clock.now()) });
          return decision;
        },
      });

      for (;;) {
        const allowed: readonly OperatorCommand[] = state === 'awaiting_human' ? ['take', 'abort'] : ['resume', 'abort'];
        const command = await Promise.race([windowClosed, broker.nextCommand(allowed, waitOptions)]);
        switch (command) {
          case 'closed':
            return await abort('surface_closed');
          case 'timeout':
            return await abort('ttl_expired');
          case 'abort':
            return await abort('aborted', options.operatorId);
          case 'take':
            move('operator_take');
            await evidence.event({ type: 'handoff_taken', stepId, interventionId, by: options.operatorId });
            tell('You have control of the browser window. Do the step there, then type resume.');
            continue;
          case 'resume':
            break;
          default: {
            const unhandled: never = command;
            return unhandled;
          }
        }

        move('operator_resume');
        const verification = await Promise.race([windowClosed, verifyWork(request)]);
        if (verification === 'closed') return await abort('surface_closed');
        if (verification.held) {
          move('checkpoint_held');
          surface.stopHumanCapture();
          await recorded;
          await capture(`handoff-${interventionId}-after`, maskTexts);
          await evidence.event({ type: 'handoff_resumed', stepId, interventionId, by: options.operatorId, actions: actions.length });
          tell('The checkpoint holds: automation has control again.');
          return { status: 'resumed', interventionId, by: options.operatorId, at: iso(clock.now()), actions };
        }
        move('checkpoint_failed');
        await evidence.event({ type: 'handoff_verify_failed', stepId, interventionId, expected: verification.expected, observed: verification.observed });
        tell(`Not done yet: expected ${verification.expected}; observed ${verification.observed}. You still have control.`);
      }
    } finally {
      waits.abort();
      unsubscribe();
      surface.stopHumanCapture();
    }
  }

  async function handOff(request: HandoffRequest): Promise<HandoffOutcome> {
    move('escalate');
    try {
      return await runHandoff(request);
    } catch (error) {
      // A handoff that broke half-way leaves nobody entitled to act on the session.
      if (state !== 'automation' && state !== 'aborted') move('handoff_failed');
      throw error;
    }
  }

  return { owner: () => ownerOf(state), humanSurfaceAvailable: options.humanSurfaceAvailable, handOff };
}
