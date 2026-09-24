import type { Verb } from './action';
import type { Candidate } from './capability';
import type { Classification, ClassificationTrigger } from './classification';
import type { ExecutionStatus, Recovery } from './execution-result';
import type { Navigation } from './resolution';

export type RunMode = 'replay';

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
      readonly verb: Verb;
      readonly decision: 'allow' | 'deny';
      readonly reason?: string;
    }
  | {
      readonly type: 'action';
      readonly stepId: string;
      readonly purpose: ActionPurpose;
      readonly verb: Verb;
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
    }
  | {
      readonly type: 'classification';
      readonly stepId: string;
      readonly trigger: ClassificationTrigger;
      readonly classification: Classification;
    }
  | { readonly type: 'recovery'; readonly stepId: string; readonly recovery: Recovery; readonly delayMs?: number }
  | { readonly type: 'output'; readonly stepId: string; readonly name: string; readonly value: string }
  | { readonly type: 'result'; readonly status: ExecutionStatus; readonly stepId?: string };

export type RunEventType = RunEvent['type'];
