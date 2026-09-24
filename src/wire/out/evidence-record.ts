// One line of run.jsonl (ADR-014): envelope first, then the event's own fields.
export interface EvidenceRecordOut {
  runId: string;
  seq: number;
  timestamp: string;
  stepId?: string;
  type: string;
  [field: string]: unknown;
}
