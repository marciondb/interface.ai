import { OpenAiChatResponseSchema, OpenAiErrorBodySchema } from '../../wire/in/openai-chat-response';
import type { OpenAiChatRequest } from '../../wire/out/openai-chat-request';
import { isLoopback, parseBaseUrl } from './endpoint';
import type { Reasoner } from './port';
import { failureFromResponse, proposeWithRetries, TransportFailure, type Send } from './propose-with-retries';

export type OpenAiCompatibleReasonerOptions = {
  readonly baseUrl: string | undefined;
  readonly model: string | undefined;
  readonly apiKey: string | undefined;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
};

export function createOpenAiCompatibleReasoner({
  baseUrl,
  model,
  apiKey,
  fetch = globalThis.fetch,
  timeoutMs = 60_000,
  retryDelayMs = 1000,
}: OpenAiCompatibleReasonerOptions): Reasoner {
  if (baseUrl === undefined || model === undefined || apiKey === undefined) {
    const missing = [
      baseUrl === undefined && 'HOSTED_BASE_URL',
      model === undefined && 'HOSTED_MODEL',
      apiKey === undefined && 'HOSTED_API_KEY',
    ].filter((name) => name !== false);
    throw new Error(`Hosted reasoner is not configured: set ${missing.join(', ')}`);
  }
  const endpoint = parseBaseUrl(baseUrl, 'HOSTED_BASE_URL');
  // The key travels in a header; only a model on this machine may be reached without TLS.
  if (endpoint.protocol !== 'https:' && !isLoopback(endpoint)) {
    throw new Error(`HOSTED_BASE_URL must use https: unless it is on this machine (localhost, 127.0.0.1 or ::1): ${endpoint.origin}`);
  }
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  // Some providers echo the key back in error bodies, and a network error message can carry it too.
  const withoutKey = (text: string) => text.replaceAll(apiKey, '[redacted]');

  const send: Send = async ({ system, user, schema }) => {
    const body: OpenAiChatRequest = {
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'agent_decision', strict: true, schema } },
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw await failureFromResponse(response, (error) => OpenAiErrorBodySchema.safeParse(error).data?.error.message);
    }
    const envelope = OpenAiChatResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!envelope.success) throw new TransportFailure(true, 'unexpected response envelope');
    return envelope.data.choices[0].message.content;
  };

  return {
    adapter: 'openai-compatible',
    model,
    propose: (input) => proposeWithRetries({ adapter: 'openai-compatible', send, retryDelayMs, redactDetail: withoutKey }, input),
  };
}
