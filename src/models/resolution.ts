import type { Candidate } from './capability';
import type { Ref } from './observation';

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
