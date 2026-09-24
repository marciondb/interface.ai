import { describe, expect, it } from 'vitest';
import type { TargetSpec } from '../../../src/models/capability';
import { targetNotes, type TargetContext } from '../../../src/logic/target-notes';

const CLICK: TargetContext = { read: false, accessibleName: true };
const UNNAMED: TargetContext = { read: false, accessibleName: false };
const READ: TargetContext = { read: true, accessibleName: true };

describe('targetNotes', () => {
  it.each<[string, TargetSpec, TargetContext, string]>([
    [
      'a role and name, with its visible text as fallback',
      { candidates: [{ strategy: 'role', role: 'link', name: 'Member Lookup' }, { strategy: 'text', text: 'Member Lookup' }] },
      CLICK,
      'Matched first by accessible role and name (link "Member Lookup"), which are stable across cosmetic markup changes. ' +
        'Fallbacks, in order: visible text "Member Lookup" (breaks if the wording changes).',
    ],
    [
      'an unnamed field, by label then generated attributes',
      {
        frame: 'content',
        candidates: [
          { strategy: 'label', text: 'Member ID:' },
          { strategy: 'attribute', name: 'name', value: 'ctl00$Main$txtMemberId' },
          { strategy: 'attribute', name: 'id', value: 'ctl00_Main_txtMemberId' },
        ],
      },
      UNNAMED,
      'Field has no accessible name, so it is matched first by its visible label "Member ID:". ' +
        "Fallbacks, in order: name attribute (unique, but tied to this tenant's markup); id attribute (unique, but tied to this tenant's markup). " +
        'Searched only inside the content frame.',
    ],
    [
      'a value read beside its label',
      { frame: 'content', candidates: [{ strategy: 'label', text: 'New Account Number:' }] },
      READ,
      'The value is record data, so it is located by its visible label "New Account Number:", never by its own text. Searched only inside the content frame.',
    ],
    [
      'a cell addressed by row and column',
      { frame: 'content', candidates: [{ strategy: 'table_cell', row: { column: 'Acct Type', equals: '{{inputs.accountType}}' }, column: 'Balance' }] },
      READ,
      'Cell located by its row (Acct Type = {{inputs.accountType}}) and column header (Balance), not by position or by its own text (record data), ' +
        'so it survives row reordering and works for any record. Searched only inside the content frame.',
    ],
    [
      'a control inside a cell',
      { candidates: [{ strategy: 'table_cell', row: { column: 'Member ID', equals: '{{inputs.memberId}}' }, column: 'Name', role: 'link' }] },
      CLICK,
      'The link in the cell located by its row (Member ID = {{inputs.memberId}}) and column header (Name), not by position or by its own text (record data), ' +
        'so it survives row reordering and works for any record.',
    ],
    [
      'an element found only by an attribute',
      { candidates: [{ strategy: 'attribute', name: 'id', value: 'btnGo' }] },
      UNNAMED,
      "It has no usable accessible name or label, so it is matched by its id attribute (unique, but tied to this tenant's markup).",
    ],
    [
      'a parameterized name',
      { candidates: [{ strategy: 'role', role: 'option', name: '{{inputs.accountType}}' }] },
      CLICK,
      'Matched first by accessible role and name (option "{{inputs.accountType}}"), which are stable across cosmetic markup changes. ' +
        'Parameterized by an input, so it follows the value replay is given.',
    ],
  ])('explains %s', (_, spec, context, expected) => {
    expect(targetNotes(spec, context)).toBe(expected);
  });

  it('says why a label comes first when the accessible name is only layout text', () => {
    expect(targetNotes({ candidates: [{ strategy: 'label', text: 'Status:' }] }, CLICK)).toBe(
      'Its accessible name is layout text rather than a handle, so it is matched first by its visible label "Status:".',
    );
  });
});
