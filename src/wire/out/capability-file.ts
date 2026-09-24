// Serialized capability artifact, schema version 1, in RFC-002 section order. Written only
// from a validated Capability model; a v1 file is that model's shape plus schemaVersion.

export type SensitivityV1 = 'none' | 'internal' | 'pii' | 'financial';

export type FieldTypeV1 = 'string' | 'number';

export interface InputSpecV1 {
  type: FieldTypeV1;
  description: string;
  pattern?: string;
  enum?: string[];
  sensitivity: SensitivityV1;
}

export interface OutputSpecV1 {
  type: FieldTypeV1;
  description: string;
  sensitivity: SensitivityV1;
}

export type CandidateV1 =
  | { strategy: 'role'; role: string; name: string }
  | { strategy: 'label'; text: string }
  | { strategy: 'attribute'; name: string; value: string }
  | { strategy: 'text'; text: string }
  | { strategy: 'table_cell'; row: { column: string; equals: string }; column: string; role?: string };

export interface TargetSpecV1 {
  frame?: string;
  candidates: CandidateV1[];
  notes?: string;
}

export type PredicateV1 =
  | { kind: 'text_visible'; text: string; frame?: string }
  | { kind: 'target_visible'; target: string }
  | { kind: 'value_equals'; target: string; value: string }
  | { kind: 'value_matches'; target: string; pattern: string };

export interface ClickActionV1 {
  kind: 'click';
  target: string;
}

export type StepActionV1 =
  | ClickActionV1
  | { kind: 'fill'; target: string; value: string }
  | { kind: 'select'; target: string; value: string }
  | { kind: 'press'; target: string; key: string }
  | { kind: 'navigate'; path: string }
  | { kind: 'read'; target: string; output: string };

export interface StepV1 {
  id: string;
  action: StepActionV1;
  risk: 'safe' | 'risky';
  checkpoint: PredicateV1;
  notes?: string;
}

export type OutcomeV1 =
  | { id: string; kind: 'business'; description?: string; when: PredicateV1 }
  | { id: string; kind: 'recoverable'; description?: string; when: PredicateV1; recover?: ClickActionV1 };

export type ProvenanceV1 =
  | { method: 'hand_written'; createdAt: string }
  | { method: 'discovered'; createdAt: string; runId: string; reasoner: { adapter: 'local' | 'hosted'; model: string } };

export interface CapabilityFileOut {
  schemaVersion: 1;
  // Absent means approved.
  status?: 'draft' | 'approved';
  capability: {
    id: string;
    version: string;
    description: string;
    app: { product: string; productVersion?: string; surface: 'web' };
  };
  preconditions: { kind: 'authenticated_session' }[];
  inputs: Record<string, InputSpecV1>;
  outputs: Record<string, OutputSpecV1>;
  targets: Record<string, TargetSpecV1>;
  steps: StepV1[];
  outcomes: OutcomeV1[];
  provenance: ProvenanceV1;
  notes?: string;
}
