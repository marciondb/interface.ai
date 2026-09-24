import { describe, expect, it } from 'vitest';
import { actionArgument, actionRef, navigateAction, toSurfaceAction } from '../../../src/logic/step-action';

describe('toSurfaceAction', () => {
  it('maps every targeted artifact action to a surface action on the resolved ref', () => {
    expect([
      toSurfaceAction({ kind: 'click', target: 't' }, 'e1'),
      toSurfaceAction({ kind: 'fill', target: 't', value: '10001' }, 'e1'),
      toSurfaceAction({ kind: 'select', target: 't', value: 'Savings' }, 'e1'),
      toSurfaceAction({ kind: 'press', target: 't', key: 'Enter' }, 'e1'),
      toSurfaceAction({ kind: 'read', target: 't', output: 'balance' }, 'e1'),
    ]).toEqual([
      { kind: 'click', ref: 'e1' },
      { kind: 'fill', ref: 'e1', value: '10001' },
      { kind: 'select', ref: 'e1', option: 'Savings' },
      { kind: 'press', ref: 'e1', key: 'Enter' },
      { kind: 'read', ref: 'e1' },
    ]);
  });

  it('resolves a navigate path against the target application', () => {
    expect(navigateAction('/member/search', 'http://localhost:8080/')).toEqual({ kind: 'navigate', url: 'http://localhost:8080/member/search' });
  });
});

describe('actionRef and actionArgument', () => {
  it('give the element and the text each action carries', () => {
    const actions = [
      { kind: 'click', ref: 'e1' },
      { kind: 'fill', ref: 'e2', value: '10001' },
      { kind: 'select', ref: 'e3', option: 'Savings' },
      { kind: 'press', ref: 'e4', key: 'Enter' },
      { kind: 'navigate', url: 'http://localhost:8080/' },
      { kind: 'read', ref: 'e5' },
    ] as const;

    expect(actions.map((action) => [actionRef(action), actionArgument(action)])).toEqual([
      ['e1', undefined],
      ['e2', '10001'],
      ['e3', 'Savings'],
      ['e4', 'Enter'],
      [undefined, 'http://localhost:8080/'],
      ['e5', undefined],
    ]);
  });
});
