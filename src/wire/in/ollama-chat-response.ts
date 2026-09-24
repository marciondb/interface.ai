import { z } from 'zod';

// Ollama native chat API, non-streaming (POST /api/chat).
export const OllamaChatResponseSchema = z.looseObject({
  message: z.looseObject({ content: z.string() }),
});

export const OllamaErrorBodySchema = z.looseObject({ error: z.string() });

export type OllamaChatResponse = z.infer<typeof OllamaChatResponseSchema>;
