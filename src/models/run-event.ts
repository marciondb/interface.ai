import type { SurfaceActionKind, Verb } from './action';
import type { Candidate } from './capability';
import type { Classification, ClassificationTrigger } from './classification';
import type { DiscoveryFailureReason, DiscoveryLimits } from './discovery';
import type { EscalationReason, ExecutionStatus, Recovery } from './execution-result';
import type { HumanAction, InterventionReason } from './intervention';
import type { Navigation } from './resolution';

export type RunMode = 'replay' | 'discovery';

export type ReasonerInfo = { readonly adapter: 'local' | 'hosted'; readonly model: string };

export type ActionPurpose = 'step' | 'recovery' | 'checkpoint';

// One line of run.jsonl before the recorder adds runId, seq and timestamp (ADR-014).
export type RunEvent =
  | {
      readonly type: 'run_started';
      readonly mode: RunMode;
      readonly capability: { readonly id: string; readonly major: number };
      readonly inputNames: readonly string[];
      readonly targetUrl: string;
    }
  | { readonly type: 'session'; readonly event: 'established' | 'reauthenticated' | 'opened' }
  | { readonly type: 'step_started'; readonly stepId: string; readonly attempt: number; readonly action: string }
  | {
      readonly type: 'target_resolved';
      readonly stepId: string;
      readonly target: string;
      readonly candidateIndex: number;
      readonly strategy: Candidate['strategy'];
      readonly counts: readonly number[];
    }
  | { readonly type: 'target_unresolved'; readonly stepId: string; readonly target: string; readonly counts: readonly number[] }
  | {
      readonly type: 'policy';
      readonly stepId: string;
      readonly purpose: ActionPurpose;
      readonly verb: SurfaceActionKind;
      readonly decision: 'allow' | 'deny' | 'requires_human';
      readonly reason?: string;
    }
  | {
      readonly type: 'action';
      readonly stepId: string;
      readonly purpose: ActionPurpose;
      readonly verb: SurfaceActionKind;
      readonly target?: string;
      readonly argument?: string;
      readonly outcome: 'done' | 'timeout' | 'error';
      readonly navigations?: readonly Navigation[];
      readonly message?: string;
    }
  | {
      readonly type: 'checkpoint';
      readonly stepId: string;
      readonly holds: boolean;
      readonly expected: string;
      readonly observed: string;
      // Set when a human performed the step during a handoff.
      readonly performedBy?: 'human';
    }
  | {
      readonly type: 'classification';
      readonly stepId: string;
      readonly trigger: ClassificationTrigger;
      readonly classification: Classification;
    }
  | { readonly type: 'recovery'; readonly stepId: string; readonly recovery: Recovery; readonly delayMs?: number }
  | { readonly type: 'output'; readonly stepId: string; readonly name: string; readonly value: string }
  // Human handoff (RFC-005); the full request is in intervention.json.
  | {
      readonly type: 'handoff_requested';
      readonly stepId: string;
      readonly interventionId: string;
      readonly reason: InterventionReason;
      readonly message: string;
      readonly expiresAt: string;
    }
  | { readonly type: 'handoff_taken'; readonly stepId: string; readonly interventionId: string; readonly by: string }
  | { readonly type: 'handoff_human_action'; readonly stepId: string; readonly interventionId: string; readonly action: HumanAction }
  | {
      readonly type: 'handoff_verify_failed';
      readonly stepId: string;
      readonly interventionId: string;
      readonly expected: string;
      readonly observed: string;
    }
  | { readonly type: 'handoff_resumed'; readonly stepId: string; readonly interventionId: string; readonly by: string; readonly actions: number }
  | {
      readonly type: 'handoff_aborted';
      readonly stepId: string;
      readonly interventionId: string;
      readonly cause: EscalationReason;
      readonly by?: string;
    }
  | {
      readonly type: 'discovery_started';
      readonly capability: { readonly id: string; readonly version: string };
      readonly goal: string;
      readonly inputNames: readonly string[];
      readonly targetUrl: string;
      readonly reasoner: ReasonerInfo;
      readonly limits: DiscoveryLimits;
    }
  // The redacted observation itself is in snapshots/.
  | { readonly type: 'observation'; readonly stepId: string; readonly observationId: number; readonly url: string; readonly elements: number }
  | {
      readonly type: 'decision';
      readonly stepId: string;
      readonly verb: Verb;
      readonly target: string | null;
      readonly argument: string | null;
      readonly rationale: string;
      readonly latencyMs: number;
      readonly reasoner: ReasonerInfo;
    }
  | { readonly type: 'grounding_rejected'; readonly stepId: string; readonly target: string | null }
  | { readonly type: 'progress'; readonly stepId: string; readonly progressed: boolean }
  | { readonly type: 'feedback'; readonly stepId: string; readonly feedback: string; readonly stalls: number }
  | { readonly type: 'artifact'; readonly capability: { readonly id: string; readonly version: string }; readonly steps: number }
  | {
      readonly type: 'result';
      readonly status: ExecutionStatus;
      readonly stepId?: string;
      readonly reason?: DiscoveryFailureReason | EscalationReason;
    };

export type RunEventType = RunEvent['type'];
