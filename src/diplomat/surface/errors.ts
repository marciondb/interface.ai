import type { SurfaceErrorCode } from './port';

// The message never carries a fill value.
export class SurfaceError extends Error {
  override readonly name = 'SurfaceError';

  constructor(
    readonly code: SurfaceErrorCode,
    detail: string,
  ) {
    super(`surface ${code}: ${detail}`);
  }
}
