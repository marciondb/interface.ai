import { describe, expect, it } from 'vitest';
import { findNode, hasRef, observationRefs } from '../../../src/logic/grounding';
import { emptyObservation, loginObservation } from '../../support/observations';

describe('grounding', () => {
  it('lists refs in document order, skipping context-only nodes', () => {
    expect(observationRefs(loginObservation())).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(observationRefs(emptyObservation())).toEqual([]);
  });

  it('tells whether a ref belongs to the observation', () => {
    expect(hasRef(loginObservation(), 'e5')).toBe(true);
    expect(hasRef(loginObservation(), 'e6')).toBe(false);
    expect(hasRef(loginObservation(), null)).toBe(false);
    expect(hasRef(emptyObservation(), 'e1')).toBe(false);
  });

  it('finds the node a ref points to', () => {
    expect(findNode(loginObservation(), 'e2')).toMatchObject({ role: 'textbox', label: 'User ID' });
    expect(findNode(loginObservation(), 'e9')).toBeUndefined();
  });
});
