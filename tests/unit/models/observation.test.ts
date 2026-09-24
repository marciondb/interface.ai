import { describe, expect, it } from 'vitest';
import { ObservationSchema } from '../../../src/models/observation';
import { emptyObservation, loginObservation } from '../../support/observations';

describe('ObservationSchema', () => {
  it('accepts the sample observations', () => {
    expect(ObservationSchema.parse(loginObservation())).toEqual(loginObservation());
    expect(ObservationSchema.safeParse(emptyObservation()).success).toBe(true);
  });

  it('accepts frames and a dialog', () => {
    const observation = {
      ...loginObservation(),
      frames: [
        { name: null, url: 'http://localhost:8080/' },
        { name: 'content', url: 'http://localhost:8080/member/lookup' },
      ],
      nodes: [
        {
          ref: 'e1',
          role: 'textbox',
          name: '',
          label: 'Member ID',
          frame: 'content',
        },
      ],
      dialog: { type: 'confirm', message: 'Are you sure?' },
    };
    expect(ObservationSchema.safeParse(observation).success).toBe(true);
  });

  it('rejects duplicate refs', () => {
    const observation = loginObservation();
    observation.nodes.push({ ref: 'e2', role: 'button', name: 'Cancel', frame: null });
    const result = ObservationSchema.safeParse(observation);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('duplicate ref e2');
  });

  it.each(['12', 'e', 'E1', 'e1a'])('rejects malformed ref %j', (ref) => {
    const observation = { ...loginObservation(), nodes: [{ ref, role: 'button', name: 'Go', frame: null }] };
    expect(ObservationSchema.safeParse(observation).success).toBe(false);
  });

  it('rejects a negative observationId', () => {
    expect(ObservationSchema.safeParse({ ...loginObservation(), observationId: -1 }).success).toBe(false);
  });
});
