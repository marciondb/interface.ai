import type { AgentDecision } from '../../models/action';
import type { Observation } from '../../models/observation';

// One line on why the previous action did not advance the run; built by the controller.
export type StepFeedback = string;

export type ReasonerInput = {
  readonly goal: string;
  // Already redacted by the caller; the reasoner does not redact.
  readonly observation: Observation;
  readonly validRefs: readonly string[];
  readonly feedback?: StepFeedback;
};

export type ReasonerAdapter = 'ollama' | 'openai-compatible';

export type Reasoner = {
  readonly adapter: ReasonerAdapter;
  readonly model: string;
  // Stateless. Resolves to a validated decision or rejects with a ReasonerError; never best-effort.
  propose(input: ReasonerInput): Promise<AgentDecision>;
};
