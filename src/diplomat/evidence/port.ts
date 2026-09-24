import type { SensitiveValue } from '../../logic/redaction';
import type { Capability } from '../../models/capability';
import type { DiscoveryResult } from '../../models/discovery';
import type { ExecutionResult } from '../../models/execution-result';
import type { InterventionRequest } from '../../models/intervention';
import type { Observation } from '../../models/observation';
import type { RunEvent, RunMode } from '../../models/run-event';

export type EvidenceRun = {
  // Also the name of the run folder.
  readonly runId: string;
  readonly dir: string;
};

export type Capture = {
  readonly screenshot?: Uint8Array;
  readonly snapshot?: Observation;
};

export type CapturePaths = {
  readonly screenshot?: string;
  readonly snapshot?: string;
};

// One run per recorder (ADR-014). Every event, snapshot and result is redacted before it is
// written (RFC-006): the recorder's secrets plus every value handed to protect() so far.
export type EvidenceRecorder = {
  startRun(run: { readonly mode: RunMode; readonly capabilityId: string }): Promise<EvidenceRun>;
  // Masks these values in everything written from now on.
  protect(values: readonly SensitiveValue[]): void;
  event(event: RunEvent): Promise<void>;
  // Writes screenshots/<seq>-<stepId>.png and snapshots/<seq>-<stepId>.json.
  capture(stepId: string, capture: Capture): Promise<CapturePaths>;
  // Writes intervention.json: the latest handoff request of the run (RFC-005).
  intervention(request: InterventionRequest): Promise<void>;
  // Writes artifact.json: the capability a discovery run produced.
  artifact(capability: Capability): Promise<void>;
  // Writes result.json.
  finish(result: ExecutionResult | DiscoveryResult): Promise<void>;
};
