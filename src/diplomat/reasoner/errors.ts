import type { ReasonerAdapter } from './port';

export type ReasonerErrorCode = 'transport' | 'invalid_output';

const MAX_DETAIL_LENGTH = 200;

export function truncateDetail(detail: string): string {
  return detail.length > MAX_DETAIL_LENGTH ? `${detail.slice(0, MAX_DETAIL_LENGTH - 3)}...` : detail;
}

// The message never carries the prompt, the observation, or credentials.
export class ReasonerError extends Error {
  override readonly name = 'ReasonerError';

  constructor(
    readonly adapter: ReasonerAdapter,
    readonly code: ReasonerErrorCode,
    readonly attempts: number,
    detail: string,
  ) {
    super(`${adapter} reasoner ${code === 'transport' ? 'transport failed' : 'gave invalid output'} after ${String(attempts)} attempt(s): ${truncateDetail(detail)}`);
  }
}
