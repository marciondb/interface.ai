import { describe, expect, it } from 'vitest';
import { ModelStepSchema } from '../../../src/models/action';

const rationale = 'because';

describe('ModelStepSchema', () => {
  it('accepts the flat answer the model fills', () => {
    const step = { verb: 'fill', target: 'e2', argument: '10001', rationale };
    expect(ModelStepSchema.parse(step)).toEqual(step);
  });

  it.each([
    ['an unknown verb', { verb: 'dance', target: null, argument: null, rationale }],
    ['an empty rationale', { verb: 'finish', target: null, argument: null, rationale: '' }],
    ['an extra key', { verb: 'finish', target: null, argument: null, rationale, confidence: 1 }],
    ['a missing key', { verb: 'finish', target: null, rationale }],
    ['a malformed ref', { verb: 'click', target: '7', argument: null, rationale }],
  ])('rejects %s', (_, step) => {
    expect(ModelStepSchema.safeParse(step).success).toBe(false);
  });
});
