import { z } from 'zod';

// OpenAI-compatible chat completions (POST /chat/completions). A null content is a refusal.
const ChoiceSchema = z.looseObject({ message: z.looseObject({ content: z.string().nullable() }) });

// Metadata the provider may add; a malformed field is dropped rather than failing the answer.
const optionalString = z.string().optional().catch(undefined);
const optionalCount = z.number().nonnegative().optional().catch(undefined);

// At least one choice; the first is the answer.
export const OpenAiChatResponseSchema = z.looseObject({
  choices: z.tuple([ChoiceSchema], ChoiceSchema),
  id: optionalString,
  model: optionalString,
  usage: z
    .looseObject({ prompt_tokens: optionalCount, completion_tokens: optionalCount, total_tokens: optionalCount })
    .optional()
    .catch(undefined),
});

export const OpenAiErrorBodySchema = z.looseObject({
  error: z.looseObject({ message: z.string() }),
});

export type OpenAiChatResponse = z.infer<typeof OpenAiChatResponseSchema>;
