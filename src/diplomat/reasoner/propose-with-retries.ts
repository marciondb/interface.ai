import { setTimeout as sleep } from 'node:timers/promises';
import { parseModelDecision } from '../../adapters/model-decision';
import { buildUserPrompt, SYSTEM_PROMPT } from '../../logic/reasoner-prompt';
import { stepJsonSchema } from '../../logic/step-schema';
import type { AgentDecision } from '../../models/action';
import { ReasonerError } from './errors';
import type { ReasonerAdapter, ReasonerInput } from './port';

export const MAX_TRANSPORT_RETRIES = 2;
export const MAX_INVALID_OUTPUT_RETRIES = 2;

export type ModelCall = {
  readonly system: string;
  readonly user: string;
  readonly schema: Record<string, unknown>;
};

// Resolves to the answer text (null = refusal) or rejects; a TransportFailure says whether to retry.
export type Send = (call: ModelCall) => Promise<string | null>;

export class TransportFailure extends Error {
  override readonly name = 'TransportFailure';

  constructor(
    readonly retryable: boolean,
    readonly detail: string,
  ) {
    super(detail);
  }
}

// Only the status and the body's error text; never headers or the request.
export async function failureFromResponse(
  response: Response,
  errorText: (body: unknown) => string | undefined,
): Promise<TransportFailure> {
  const text = await response.text().catch(() => '');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const detail = errorText(body);
  const retryable = response.status === 429 || response.status >= 500;
  return new TransportFailure(retryable, detail === undefined ? `HTTP ${String(response.status)}` : `HTTP ${String(response.status)} ${detail}`);
}

function asTransportFailure(error: unknown): TransportFailure {
  if (error instanceof TransportFailure) return error;
  if (error instanceof Error && error.name === 'TimeoutError') return new TransportFailure(true, 'request timed out');
  return new TransportFailure(true, `network error: ${error instanceof Error ? error.message : String(error)}`);
}

export type RetryOptions = {
  readonly adapter: ReasonerAdapter;
  readonly send: Send;
  readonly retryDelayMs: number;
};

async function sendWithRetries({ adapter, send, retryDelayMs }: RetryOptions, call: ModelCall): Promise<string | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send(call);
    } catch (error) {
      const failure = asTransportFailure(error);
      if (!failure.retryable || attempt > MAX_TRANSPORT_RETRIES) {
        throw new ReasonerError(adapter, 'transport', attempt, failure.detail);
      }
      if (retryDelayMs > 0) await sleep(retryDelayMs * attempt);
    }
  }
}

export async function proposeWithRetries(options: RetryOptions, input: ReasonerInput): Promise<AgentDecision> {
  const schema = stepJsonSchema(input.validRefs);
  let repair: string | undefined;
  for (let attempt = 1; ; attempt++) {
    const user = buildUserPrompt({ goal: input.goal, observation: input.observation, feedback: input.feedback, repair });
    const content = await sendWithRetries(options, { system: SYSTEM_PROMPT, user, schema });
    const result = parseModelDecision(content, input.validRefs);
    if (result.ok) return result.decision;
    if (attempt > MAX_INVALID_OUTPUT_RETRIES) {
      throw new ReasonerError(options.adapter, 'invalid_output', attempt, result.reason);
    }
    repair = result.reason;
  }
}
