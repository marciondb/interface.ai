import { describe, expect, it } from 'vitest';
import { toSurfaceAction } from '../../../src/logic/step-action';
import { ActionSchema } from '../../../src/models/action';

describe('toSurfaceAction', () => {
  it('maps every artifact action to a valid surface action', () => {
    const target = 'http://localhost:8080/';
    const actions = [
      toSurfaceAction('s', { kind: 'click', target: 't' }, 'e1', target),
      toSurfaceAction('s', { kind: 'fill', target: 't', value: '10001' }, 'e1', target),
      toSurfaceAction('s', { kind: 'select', target: 't', value: 'Savings' }, 'e1', target),
      toSurfaceAction('s', { kind: 'press', target: 't', key: 'Enter' }, 'e1', target),
      toSurfaceAction('s', { kind: 'navigate', path: '/member/search' }, null, target),
      toSurfaceAction('s', { kind: 'read', target: 't', output: 'balance' }, 'e1', target),
    ];

    expect(actions.map((action) => ActionSchema.safeParse(action).success)).toEqual([true, true, true, true, true, true]);
    expect(actions.map((action) => [action.verb, action.argument])).toEqual([
      ['click', null],
      ['fill', '10001'],
      ['select', 'Savings'],
      ['press', 'Enter'],
      ['navigate', 'http://localhost:8080/member/search'],
      ['read', 'balance'],
    ]);
  });
});
