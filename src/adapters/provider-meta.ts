import type { ProviderMeta } from '../models/discovery';
import type { OllamaChatResponse } from '../wire/in/ollama-chat-response';
import type { OpenAiChatResponse } from '../wire/in/openai-chat-response';

// value without its undefined fields, so the evidence shows only what the provider sent.
function present<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

export function ollamaMeta(response: OllamaChatResponse): ProviderMeta {
  return present({
    provider: 'ollama',
    model: response.model,
    createdAt: response.created_at,
    totalDurationNs: response.total_duration,
    evalCount: response.eval_count,
    promptEvalCount: response.prompt_eval_count,
  });
}

export function openAiMeta(response: OpenAiChatResponse): ProviderMeta {
  const { usage } = response;
  return present({
    provider: 'openai-compatible',
    id: response.id,
    model: response.model,
    usage:
      usage === undefined
        ? undefined
        : present({ promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens }),
  });
}
