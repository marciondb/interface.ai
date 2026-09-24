import { describe, expect, it } from 'vitest';
import { stepActionSchema, stepJsonSchema } from '../../../src/logic/step-schema';
import { VERBS } from '../../../src/models/action';

const ALLOWED_KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'enum', 'anyOf']);

function keywords(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(keywords);
  if (typeof schema !== 'object' || schema === null) return [];
  return Object.entries(schema).flatMap(([key, value]) =>
    key === 'properties' ? [key, ...Object.values(value as object).flatMap(keywords)] : [key, ...keywords(value)],
  );
}

describe('stepJsonSchema', () => {
  const schema = stepJsonSchema(['e1', 'e2']);

  it('lists every verb and narrows target to the given refs', () => {
    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        verb: { enum: [...VERBS] },
        target: { anyOf: [{ type: 'string', enum: ['e1', 'e2'] }, { type: 'null' }] },
      },
      additionalProperties: false,
    });
    expect(schema.required).toEqual(['verb', 'target', 'argument', 'rationale']);
  });

  it('is plain JSON within the subset Ollama and OpenAI strict mode accept', () => {
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
    expect(keywords(schema).filter((key) => !ALLOWED_KEYWORDS.has(key))).toEqual([]);
  });

  it('only admits a null target when there are no refs', () => {
    expect(stepJsonSchema([]).properties?.target).toEqual({ type: 'null' });
  });
});

describe('stepActionSchema', () => {
  const base = { verb: 'click', argument: null, rationale: 'go' };

  it('accepts listed refs and null, and rejects any other ref', () => {
    const step = stepActionSchema(['e1', 'e2']);
    expect(step.safeParse({ ...base, target: 'e1' }).success).toBe(true);
    expect(step.safeParse({ ...base, target: null }).success).toBe(true);
    expect(step.safeParse({ ...base, target: 'e3' }).success).toBe(false);
  });

  it('rejects every ref when the list is empty', () => {
    const step = stepActionSchema([]);
    expect(step.safeParse({ ...base, target: null }).success).toBe(true);
    expect(step.safeParse({ ...base, target: 'e1' }).success).toBe(false);
  });
});
