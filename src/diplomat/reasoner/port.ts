import type { AgentDecision } from '../../models/action';
import type { Observation } from '../../models/observation';

export type ReasonerInput = {
  readonly goal: string;
  // Already redacted by the caller; the reasoner does not redact.
  readonly observation: Observation;
  readonly validRefs: readonly string[];
  // One line on why the previous action did not advance the run; built by the controller.
  readonly feedback?: string;
};

export type ReasonerAdapter = 'ollama' | 'openai-compatible';

export const REASONER_ERROR_CODES = ['transport', 'invalid_output'] as const;

export type ReasonerErrorCode = (typeof REASONER_ERROR_CODES)[number];

// The reasoner gave up: its transport kept failing or its answers stayed invalid after the retries.
// The message never carries the prompt, the observation, or credentials.
export type ReasonerFailure = Error & { readonly name: 'ReasonerError'; readonly code: ReasonerErrorCode };

export function isReasonerError(error: unknown): error is ReasonerFailure {
  return error instanceof Error && error.name === 'ReasonerError' && 'code' in error && (REASONER_ERROR_CODES as readonly unknown[]).includes(error.code);
}

export type Reasoner = {
  readonly adapter: ReasonerAdapter;
  readonly model: string;
  // Stateless. Resolves to a validated decision or rejects with a ReasonerFailure; never best-effort.
  propose(input: ReasonerInput): Promise<AgentDecision>;
};
