import { describe, expect, it } from 'vitest';
import { parseModelDecision } from '../../../src/adapters/model-decision';
import { VERBS } from '../../../src/models/action';

const refs = ['e1', 'e2', 'e3', 'e4'];
const rationale = 'because';

const validByVerb = [
  [{ verb: 'click', target: 'e1', argument: null }, { kind: 'act', action: { kind: 'click', ref: 'e1' } }],
  [{ verb: 'fill', target: 'e2', argument: '10001' }, { kind: 'act', action: { kind: 'fill', ref: 'e2', value: '10001' } }],
  [{ verb: 'select', target: 'e3', argument: 'Savings' }, { kind: 'act', action: { kind: 'select', ref: 'e3', option: 'Savings' } }],
  [{ verb: 'press', target: 'e1', argument: 'Enter' }, { kind: 'act', action: { kind: 'press', ref: 'e1', key: 'Enter' } }],
  [
    { verb: 'navigate', target: null, argument: 'http://localhost:8080/' },
    { kind: 'act', action: { kind: 'navigate', url: 'http://localhost:8080/' } },
  ],
  [{ verb: 'read', target: 'e4', argument: 'balance' }, { kind: 'read', action: { kind: 'read', ref: 'e4' }, output: 'balance' }],
  [{ verb: 'finish', target: null, argument: null }, { kind: 'finish', summary: null }],
  [{ verb: 'request_help', target: null, argument: 'stuck on an unknown screen' }, { kind: 'request_help', message: 'stuck on an unknown screen' }],
] as const;

function parse(answer: object) {
  return parseModelDecision(JSON.stringify({ ...answer, rationale }), refs);
}

describe('parseModelDecision', () => {
  it('has a valid example for every verb', () => {
    expect(validByVerb.map(([answer]) => answer.verb)).toEqual([...VERBS]);
  });

  it.each(validByVerb)('turns a valid %o into its decision', (answer, decision) => {
    expect(parse(answer)).toEqual({ ok: true, decision: { ...decision, rationale } });
  });

  it.each([
    ['click without target', { verb: 'click', target: null, argument: null }, 'click requires target'],
    ['click with an argument', { verb: 'click', target: 'e1', argument: 'x' }, 'click does not take argument'],
    ['press without target', { verb: 'press', target: null, argument: 'Enter' }, 'press requires target'],
    ['navigate with target', { verb: 'navigate', target: 'e1', argument: 'http://x/' }, 'navigate does not take target'],
    ['fill without argument', { verb: 'fill', target: 'e1', argument: null }, 'fill requires argument'],
    ['request_help without reason', { verb: 'request_help', target: null, argument: null }, 'request_help requires argument'],
  ])('rejects %s', (_, answer, message) => {
    expect(parse(answer)).toEqual({ ok: false, reason: message });
  });

  it('reports every broken verb rule', () => {
    expect(parse({ verb: 'navigate', target: 'e1', argument: null })).toEqual({
      ok: false,
      reason: 'navigate does not take target; navigate requires argument',
    });
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

  it('rejects a ref that is not on the screen', () => {
    const answer = '{"verb":"click","target":"e99","argument":null,"rationale":"x"}';
    expect(parseModelDecision(answer, refs)).toEqual({ ok: false, reason: 'target e99 is not on the screen' });
  });
});
