import { describe, expect, it } from 'vitest';
import { toEvidenceRecord } from '../../../src/adapters/evidence-record';

const ENVELOPE = { runId: 'run-1', seq: 4, timestamp: '2026-09-24T12:00:00.000Z' };

describe('toEvidenceRecord', () => {
  it('puts the envelope and stepId first, then the event fields', () => {
    const record = toEvidenceRecord({ type: 'checkpoint', stepId: 'read-balance', holds: true, expected: 'e', observed: 'o' }, ENVELOPE);

    expect(Object.keys(record)).toEqual(['runId', 'seq', 'timestamp', 'stepId', 'type', 'holds', 'expected', 'observed']);
    expect(record).toMatchObject({ ...ENVELOPE, stepId: 'read-balance', type: 'checkpoint' });
  });

  it('omits stepId for run-level events', () => {
    expect(toEvidenceRecord({ type: 'session', event: 'established' }, ENVELOPE)).toEqual({
      ...ENVELOPE,
      type: 'session',
      event: 'established',
    });
  });
});
