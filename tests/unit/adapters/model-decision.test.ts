import { describe, expect, it } from 'vitest';
import { parseModelDecision } from '../../../src/adapters/model-decision';

const refs = ['e1', 'e2'];

describe('parseModelDecision', () => {
  it('accepts a valid decision aimed at a listed ref', () => {
    const decision = { verb: 'fill', target: 'e1', argument: 'apple', rationale: 'search field' };
    expect(parseModelDecision(JSON.stringify(decision), refs)).toEqual({ ok: true, decision });
  });

  it('rejects text that is not JSON', () => {
    expect(parseModelDecision('{"verb": "click"', refs)).toEqual({ ok: false, reason: 'the answer was not valid JSON' });
  });

  it('rejects an empty answer or a refusal', () => {
    expect(parseModelDecision(null, refs)).toEqual({ ok: false, reason: 'the answer was empty' });
    expect(parseModelDecision('  ', refs)).toEqual({ ok: false, reason: 'the answer was empty' });
  });

  it('rejects an unknown verb with a short one-line reason', () => {
    const result = parseModelDecision('{"verb":"dance","target":null,"argument":null,"rationale":"x"}', refs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('verb');
    expect(result.reason).not.toContain('\n');
    expect(result.reason.length).toBeLessThanOrEqual(200);
  });

  it('rejects a decision that breaks the verb rules', () => {
    const result = parseModelDecision('{"verb":"click","target":null,"argument":null,"rationale":"x"}', refs);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('click requires target') as unknown });
  });

  it('rejects a ref that is not on the screen', () => {
    const answer = '{"verb":"click","target":"e99","argument":null,"rationale":"x"}';
    expect(parseModelDecision(answer, refs)).toEqual({ ok: false, reason: 'target e99 is not on the screen' });
  });
});
