// Serialized capability artifact, in RFC-002 section order. Section contents are
// written only from a validated Capability model.
export interface CapabilityFileOut {
  schemaVersion: 1;
  capability: unknown;
  preconditions: unknown;
  inputs: unknown;
  outputs: unknown;
  targets: unknown;
  steps: unknown;
  outcomes: unknown;
  provenance: unknown;
  notes?: string;
}
