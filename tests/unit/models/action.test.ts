import { describe, expect, it } from 'vitest';
import { ActionSchema, VERBS } from '../../../src/models/action';

const rationale = 'because';

const validByVerb = [
  { verb: 'click', target: 'e1', argument: null },
  { verb: 'fill', target: 'e2', argument: '10001' },
  { verb: 'select', target: 'e3', argument: 'Savings' },
  { verb: 'press', target: null, argument: 'Enter' },
  { verb: 'navigate', target: null, argument: 'http://localhost:8080/' },
  { verb: 'read', target: 'e4', argument: 'balance' },
  { verb: 'finish', target: null, argument: null },
  { verb: 'request_help', target: null, argument: 'stuck on an unknown screen' },
] as const;

describe('ActionSchema', () => {
  it('has a valid example for every verb', () => {
    expect(validByVerb.map((action) => action.verb)).toEqual([...VERBS]);
  });

  it.each(validByVerb)('accepts a valid $verb', (action) => {
    expect(ActionSchema.parse({ ...action, rationale })).toEqual({ ...action, rationale });
  });

  it.each([
    ['click without target', { verb: 'click', target: null, argument: null }, 'click requires target'],
    ['navigate with target', { verb: 'navigate', target: 'e1', argument: 'http://x/' }, 'navigate does not take target'],
    ['fill without argument', { verb: 'fill', target: 'e1', argument: null }, 'fill requires argument'],
    ['request_help without reason', { verb: 'request_help', target: null, argument: null }, 'request_help requires argument'],
  ])('rejects %s', (_, action, message) => {
    const result = ActionSchema.safeParse({ ...action, rationale });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(message);
  });

  it.each([
    ['an unknown verb', { verb: 'dance', target: null, argument: null, rationale }],
    ['an empty rationale', { verb: 'finish', target: null, argument: null, rationale: '' }],
    ['an extra key', { verb: 'finish', target: null, argument: null, rationale, confidence: 1 }],
    ['a missing key', { verb: 'finish', target: null, rationale }],
    ['a malformed ref', { verb: 'click', target: '7', argument: null, rationale }],
  ])('rejects %s', (_, action) => {
    expect(ActionSchema.safeParse(action).success).toBe(false);
  });
});
