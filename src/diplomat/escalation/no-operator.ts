import type { EscalationBroker } from './port';

// No operator is attached, so every escalation ends the run; the controller has already
// recorded the escalation and the screen.
export const noOperatorBroker: EscalationBroker = {
  escalate: () => Promise.resolve('aborted'),
};
