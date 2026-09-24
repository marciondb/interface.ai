import { OllamaChatResponseSchema, OllamaErrorBodySchema } from '../../wire/in/ollama-chat-response';
import type { OllamaChatRequest } from '../../wire/out/ollama-chat-request';
import type { Reasoner } from './port';
import { failureFromResponse, proposeWithRetries, TransportFailure, type Send } from './propose-with-retries';

export type OllamaReasonerOptions = {
  readonly baseUrl: string;
  readonly model: string;
  readonly fetch?: typeof globalThis.fetch;
  // Covers loading the model into memory on the first call on a laptop.
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
};

export function createOllamaReasoner({
  baseUrl,
  model,
  fetch = globalThis.fetch,
  timeoutMs = 120_000,
  retryDelayMs = 1000,
}: OllamaReasonerOptions): Reasoner {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/chat`;

  const send: Send = async ({ system, user, schema }) => {
    const body: OllamaChatRequest = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      format: schema,
      stream: false,
      think: false,
      options: { temperature: 0 },
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw await failureFromResponse(response, (error) => OllamaErrorBodySchema.safeParse(error).data?.error);
    }
    const envelope = OllamaChatResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!envelope.success) throw new TransportFailure(true, 'unexpected response envelope');
    return envelope.data.message.content;
  };

  return {
    adapter: 'ollama',
    model,
    propose: (input) => proposeWithRetries({ adapter: 'ollama', send, retryDelayMs }, input),
  };
}
