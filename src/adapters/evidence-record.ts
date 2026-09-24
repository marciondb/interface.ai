import type { RunEvent } from '../models/run-event';
import type { EvidenceRecordOut } from '../wire/out/evidence-record';

export type RecordEnvelope = {
  readonly runId: string;
  readonly seq: number;
  readonly timestamp: string;
};

export function toEvidenceRecord(event: RunEvent, envelope: RecordEnvelope): EvidenceRecordOut {
  const { type, ...fields } = event;
  const stepId = 'stepId' in event ? event.stepId : undefined;
  return {
    runId: envelope.runId,
    seq: envelope.seq,
    timestamp: envelope.timestamp,
    ...(stepId === undefined ? {} : { stepId }),
    type,
    ...fields,
  };
}
