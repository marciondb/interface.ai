import type { DiscoveryEscalationReason } from '../../models/discovery';

export type EscalationRequest = {
  readonly runId: string;
  readonly stepId: string;
  readonly reason: DiscoveryEscalationReason;
  readonly message: string;
};

// `resumed`: an operator handled it and automation continues; `aborted`: the run ends escalated.
export type EscalationDecision = 'resumed' | 'aborted';

// Hands a run to a human (RFC-005).
export type EscalationBroker = {
  escalate(request: EscalationRequest): Promise<EscalationDecision>;
};
