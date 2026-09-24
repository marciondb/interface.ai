import { truncate } from '../../infrastructure/errors';
import type { ReasonerAdapter, ReasonerErrorCode, ReasonerFailure } from './port';

const MAX_DETAIL_LENGTH = 200;

// The message never carries the prompt, the observation, or credentials.
export class ReasonerError extends Error implements ReasonerFailure {
  override readonly name = 'ReasonerError';

  constructor(
    readonly adapter: ReasonerAdapter,
    readonly code: ReasonerErrorCode,
    readonly attempts: number,
    detail: string,
  ) {
    super(`${adapter} reasoner ${code === 'transport' ? 'transport failed' : 'gave invalid output'} after ${String(attempts)} attempt(s): ${truncate(detail, MAX_DETAIL_LENGTH)}`);
  }
}
