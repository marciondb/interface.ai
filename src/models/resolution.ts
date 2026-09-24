import type { Candidate } from './capability';
import type { Ref } from './observation';
import type { Landing } from './policy';

// counts[i] is how many elements candidate i matched; resolution stops at the first exact match (ADR-008).
export type Resolution =
  | {
      readonly status: 'resolved';
      readonly ref: Ref;
      readonly candidateIndex: number;
      readonly strategy: Candidate['strategy'];
      readonly counts: readonly number[];
    }
  | { readonly status: 'unresolved'; readonly counts: readonly number[] };

// What the gateway needs to judge an action on an element.
export type ElementInfo = {
  readonly role: string;
  readonly name: string;
  // Every other text a person may read as the control's label: text, value, alt, title,
  // aria-labelledby, image alts. Risky control text is looked for in these too.
  readonly texts?: readonly string[];
  readonly frameUrl: string;
  // Link href or submit form action, as an absolute URL.
  readonly destination?: string;
};

export type Navigation = {
  readonly url: string;
  readonly status: number;
};

export type PerformOutcome =
  | { readonly status: 'done'; readonly value?: string; readonly navigations: readonly Navigation[] }
  | { readonly status: 'timeout' }
  | { readonly status: 'error'; readonly message: string };

// How the action gateway answered an action. `denied` and `requires_human` mean the driver was
// not called. `denied` is outside the allowlist, or CONTROL_OWNED_BY_HUMAN; `requires_human` is
// a risky action only a human may perform (RFC-005). `landed_outside_policy` means the driver
// acted and the page ended up outside the policy: a hard stop.
export type GatewayOutcome =
  | PerformOutcome
  | { readonly status: 'denied'; readonly reason: string }
  | { readonly status: 'requires_human'; readonly reason: string }
  | ({ readonly status: 'landed_outside_policy' } & Landing);
