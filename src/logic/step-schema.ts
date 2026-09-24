import { z } from 'zod';
import { ActionFieldsSchema } from '../models/action';

// Generation grammar only: it must stay within the JSON Schema subset that both
// Ollama `format` and OpenAI strict `response_format` accept. Per-verb rules and a
// non-empty rationale are enforced afterwards by ActionSchema.
export function stepActionSchema(refs: readonly string[]) {
  const target = refs.length === 0 ? z.null() : z.enum(refs).nullable();
  return ActionFieldsSchema.extend({ target, rationale: z.string() });
}

export function stepJsonSchema(refs: readonly string[]) {
  const schema = z.toJSONSchema(stepActionSchema(refs));
  delete schema.$schema;
  return schema;
}
