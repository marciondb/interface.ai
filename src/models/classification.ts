import type { Outcome } from './capability';

// What failed when the observation was classified (RFC-004, Classification).
export type ClassificationTrigger = 'target_unresolved' | 'action_timeout' | 'checkpoint_not_met';

export type Classification =
  | { readonly kind: 'business'; readonly outcomeId: string }
  | {
      readonly kind: 'recoverable';
      readonly outcomeId: string;
      readonly recover?: Extract<Outcome, { kind: 'recoverable' }>['recover'];
    }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'session_expired' }
  | { readonly kind: 'server_error' }
  | { readonly kind: 'target_not_found' }
  | { readonly kind: 'target_ambiguous' }
  | { readonly kind: 'unknown' };
