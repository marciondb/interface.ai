import { z } from 'zod';

// OpenAI-compatible chat completions (POST /chat/completions). A null content is a refusal.
export const OpenAiChatResponseSchema = z.looseObject({
  choices: z
    .array(z.looseObject({ message: z.looseObject({ content: z.string().nullable() }) }))
    .min(1),
});

export const OpenAiErrorBodySchema = z.looseObject({
  error: z.looseObject({ message: z.string() }),
});

export type OpenAiChatResponse = z.infer<typeof OpenAiChatResponseSchema>;
