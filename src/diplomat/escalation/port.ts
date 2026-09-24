import type { DialogDecision, InterventionRequest } from '../../models/intervention';
import type { Dialog } from '../../models/observation';

export type OperatorCommand = 'take' | 'resume' | 'abort';

export type WaitOptions = {
  // Epoch milliseconds; the wait ends with 'timeout' then.
  readonly expiresAt: number;
  // Aborting ends the wait with 'timeout', e.g. when the window was closed.
  readonly signal: AbortSignal;
};

// The channel to the human operator during a handoff (RFC-005). It only talks to the operator;
// the escalation controller owns the control state and the evidence.
export type EscalationBroker = {
  // Shows the intervention request.
  publish(request: InterventionRequest): void;
  // The next command among `allowed`; anything else is answered with the help text.
  nextCommand(allowed: readonly OperatorCommand[], options: WaitOptions): Promise<OperatorCommand | 'timeout'>;
  // Asks how to answer a native dialog raised while the human holds control.
  askDialog(dialog: Dialog, options: WaitOptions): Promise<DialogDecision | 'timeout'>;
  notify(text: string): void;
  // Releases the operator's input so the process can exit.
  close(): void;
};
