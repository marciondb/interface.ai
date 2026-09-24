import { describe, expect, it } from 'vitest';
import { matchHumanTarget } from '../../../src/logic/human-trace';
import type { Observation } from '../../../src/models/observation';

const DETAIL: Observation = {
  observationId: 7,
  url: 'http://localhost:8080/',
  frames: [
    { name: null, url: 'http://localhost:8080/' },
    { name: 'content', url: 'http://localhost:8080/member/detail?memberId=10001' },
  ],
  nodes: [
    { ref: 'e1', role: 'link', name: 'Member Lookup', frame: null },
    { role: 'text', name: 'Close Account', frame: 'content' },
    { ref: 'e2', role: 'button', name: 'Open Sub-Account', frame: 'content' },
    { ref: 'e3', role: 'button', name: 'Close Account', frame: 'content' },
  ],
  dialog: null,
};

describe('matchHumanTarget', () => {
  it('matches an addressable element by role and name', () => {
    const node = matchHumanTarget({ frame: 'content', tag: 'input', role: 'button', name: 'Close Account' }, DETAIL);

    expect(node?.ref).toBe('e3');
  });

  it('does not match an element of another frame', () => {
    expect(matchHumanTarget({ frame: null, tag: 'input', role: 'button', name: 'Close Account' }, DETAIL)).toBeUndefined();
  });

  it('does not match when nothing identifies the element', () => {
    expect(matchHumanTarget({ frame: 'content', tag: 'td' }, DETAIL)).toBeUndefined();
  });
});
