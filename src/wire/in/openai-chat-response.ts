import { z } from 'zod';

// OpenAI-compatible chat completions (POST /chat/completions). A null content is a refusal.
const ChoiceSchema = z.looseObject({ message: z.looseObject({ content: z.string().nullable() }) });

// At least one choice; the first is the answer.
export const OpenAiChatResponseSchema = z.looseObject({
  choices: z.tuple([ChoiceSchema], ChoiceSchema),
});

export const OpenAiErrorBodySchema = z.looseObject({
  error: z.looseObject({ message: z.string() }),
});

export type OpenAiChatResponse = z.infer<typeof OpenAiChatResponseSchema>;
