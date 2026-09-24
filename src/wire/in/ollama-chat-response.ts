import { z } from 'zod';

// Metadata the server may add; a malformed field is dropped rather than failing the answer.
const optionalString = z.string().optional().catch(undefined);
const optionalCount = z.number().nonnegative().optional().catch(undefined);

// Ollama native chat API, non-streaming (POST /api/chat).
export const OllamaChatResponseSchema = z.looseObject({
  message: z.looseObject({ content: z.string() }),
  model: optionalString,
  created_at: optionalString,
  // Nanoseconds.
  total_duration: optionalCount,
  eval_count: optionalCount,
  prompt_eval_count: optionalCount,
});

export const OllamaErrorBodySchema = z.looseObject({ error: z.string() });

export type OllamaChatResponse = z.infer<typeof OllamaChatResponseSchema>;
