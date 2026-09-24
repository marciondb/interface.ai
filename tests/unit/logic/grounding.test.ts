import { describe, expect, it } from 'vitest';
import { findNode, observationRefs } from '../../../src/logic/grounding';
import { emptyObservation, loginObservation } from '../../support/observations';

describe('grounding', () => {
  it('lists refs in document order, skipping context-only nodes', () => {
    expect(observationRefs(loginObservation())).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(observationRefs(emptyObservation())).toEqual([]);
  });

  it('finds the node a ref points to', () => {
    expect(findNode(loginObservation(), 'e2')).toMatchObject({ role: 'textbox', label: 'User ID' });
    expect(findNode(loginObservation(), 'e9')).toBeUndefined();
  });
});
