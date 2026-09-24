import type { ExecutionResult } from '../../models/execution-result';
import type { Observation } from '../../models/observation';
import type { RunEvent, RunMode } from '../../models/run-event';

export type EvidenceRun = {
  // Also the name of the run folder.
  readonly runId: string;
  readonly dir: string;
};

export type FailureCapture = {
  readonly screenshot?: Uint8Array;
  readonly snapshot?: Observation;
};

export type CapturePaths = {
  readonly screenshot?: string;
  readonly snapshot?: string;
};

// One run per recorder (ADR-014). Every record is redacted before it is written.
export type EvidenceRecorder = {
  startRun(run: { readonly mode: RunMode; readonly capabilityId: string }): Promise<EvidenceRun>;
  event(event: RunEvent): Promise<void>;
  // Writes screenshots/<seq>-<stepId>.png and snapshots/<seq>-<stepId>.json.
  failureCapture(stepId: string, capture: FailureCapture): Promise<CapturePaths>;
  // Writes result.json.
  finish(result: ExecutionResult): Promise<void>;
};
