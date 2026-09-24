import { describe, expect, it } from 'vitest';
import { describeCounts, evaluateCheckpoint, factsNeeded, matchesDetector, type Facts } from '../../../src/logic/checkpoint';
import type { Candidate } from '../../../src/models/capability';
import type { Observation } from '../../../src/models/observation';

const CANDIDATES: Candidate[] = [
  { strategy: 'label', text: 'Member ID:' },
  { strategy: 'attribute', name: 'name', value: 'txtMemberId' },
];

function results(text: string): Observation {
  return {
    observationId: 3,
    url: 'http://localhost:8080/',
    frames: [
      { name: null, url: 'http://localhost:8080/' },
      { name: 'content', url: 'http://localhost:8080/member/results?memberId=99999' },
    ],
    nodes: [
      { ref: 'e1', role: 'link', name: 'Member Lookup', frame: null },
      { role: 'text', name: text, frame: 'content' },
    ],
    dialog: null,
  };
}

function facts(targets: Facts['targets'] = {}): Facts {
  return { observation: results('No   records\nfound.'), targets };
}

describe('evaluateCheckpoint', () => {
  it('finds visible text within the named frame, ignoring whitespace differences', () => {
    expect(evaluateCheckpoint({ kind: 'text_visible', text: 'No records found.', frame: 'content' }, facts())).toMatchObject({ holds: true });
    expect(evaluateCheckpoint({ kind: 'text_visible', text: 'Member Lookup', frame: 'content' }, facts())).toEqual({
      holds: false,
      expected: 'text "Member Lookup" visible in frame content (http://localhost:8080/member/results?memberId=99999)',
      observed: 'text not visible in frame content (http://localhost:8080/member/results?memberId=99999)',
    });
    expect(evaluateCheckpoint({ kind: 'text_visible', text: 'Member Lookup' }, facts())).toMatchObject({ holds: true });
  });

  it('holds for a target only when it resolved, and reports the counts otherwise', () => {
    const resolved = facts({ 'lookup.memberId': { candidates: CANDIDATES, counts: [1], resolved: true } });
    const missing = facts({ 'lookup.memberId': { candidates: CANDIDATES, counts: [0, 2], resolved: false } });

    expect(evaluateCheckpoint({ kind: 'target_visible', target: 'lookup.memberId' }, resolved)).toMatchObject({ holds: true });
    expect(evaluateCheckpoint({ kind: 'target_visible', target: 'lookup.memberId' }, missing)).toEqual({
      holds: false,
      expected: 'lookup.memberId matches exactly one element',
      observed: 'lookup.memberId did not resolve: label "Member ID:" matched 0, attribute name="txtMemberId" matched 2',
    });
    expect(evaluateCheckpoint({ kind: 'target_visible', target: 'lookup.memberId' }, facts())).toMatchObject({
      holds: false,
      observed: 'lookup.memberId was not looked up',
    });
  });

  it('compares values exactly or by pattern', () => {
    const balance = facts({ 'detail.balance': { candidates: CANDIDATES, counts: [1], resolved: true, value: '4,812.37' } });

    expect(evaluateCheckpoint({ kind: 'value_equals', target: 'detail.balance', value: '4,812.37' }, balance)).toMatchObject({ holds: true });
    expect(evaluateCheckpoint({ kind: 'value_equals', target: 'detail.balance', value: '4812.37' }, balance)).toEqual({
      holds: false,
      expected: 'detail.balance value "4812.37"',
      observed: 'value "4,812.37"',
    });
    expect(evaluateCheckpoint({ kind: 'value_matches', target: 'detail.balance', pattern: '^[0-9,]+\\.[0-9]{2}$' }, balance)).toMatchObject({
      holds: true,
    });
    expect(evaluateCheckpoint({ kind: 'value_matches', target: 'detail.balance', pattern: '^x$' }, facts())).toMatchObject({ holds: false });
  });

  it('shares its predicate evaluation with outcome detectors', () => {
    expect(matchesDetector({ kind: 'text_visible', text: 'records found', frame: 'content' }, facts())).toBe(true);
    expect(matchesDetector({ kind: 'text_visible', text: 'not authorized', frame: 'content' }, facts())).toBe(false);
  });
});

describe('factsNeeded', () => {
  it('lists each target once and reads values only for value predicates', () => {
    expect(
      factsNeeded([
        { kind: 'target_visible', target: 'a' },
        { kind: 'text_visible', text: 'x' },
        { kind: 'value_equals', target: 'a', value: '1' },
        { kind: 'target_visible', target: 'b' },
      ]),
    ).toEqual([
      { target: 'a', needsValue: true },
      { target: 'b', needsValue: false },
    ]);
  });
});

describe('describeCounts', () => {
  it('describes only the candidates that were tried', () => {
    const cell: Candidate = { strategy: 'table_cell', row: { column: 'Acct Type', equals: 'Savings' }, column: 'Balance' };

    expect(describeCounts([cell, ...CANDIDATES], [0])).toBe('table_cell in column "Balance" where "Acct Type" = "Savings" matched 0');
    expect(describeCounts(CANDIDATES, [])).toBe('no candidate could be tried');
  });
});
