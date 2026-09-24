import { describe, expect, it } from 'vitest';
import { nextMove } from '../../../src/logic/recovery';

const FRESH = { attempt: 0, reauthUsed: false };

describe('nextMove', () => {
  it('returns business outcomes as they are', () => {
    expect(nextMove({ kind: 'business', outcomeId: 'member_not_found' }, FRESH)).toEqual({
      move: 'return_business',
      outcomeId: 'member_not_found',
    });
  });

  it('retries a timeout twice with backoff, then fails', () => {
    expect(nextMove({ kind: 'timeout' }, FRESH)).toEqual({ move: 'retry_after', delayMs: 500, condition: 'timeout' });
    expect(nextMove({ kind: 'timeout' }, { attempt: 1, reauthUsed: false })).toEqual({
      move: 'retry_after',
      delayMs: 1_000,
      condition: 'timeout',
    });
    expect(nextMove({ kind: 'timeout' }, { attempt: 2, reauthUsed: false })).toEqual({ move: 'fail', code: 'timeout' });
  });

  it('applies a declared recovery at most twice', () => {
    const interstitial = { kind: 'recoverable', outcomeId: 'interstitial', recover: { kind: 'click', target: 'interstitial.continue' } } as const;

    expect(nextMove(interstitial, FRESH)).toEqual({ move: 'apply_recovery', outcomeId: 'interstitial', recover: interstitial.recover });
    expect(nextMove(interstitial, { attempt: 2, reauthUsed: false })).toEqual({ move: 'fail', code: 'recovery_exhausted' });
    expect(nextMove({ kind: 'recoverable', outcomeId: 'banner' }, FRESH)).toEqual({ move: 'retry_after', delayMs: 500, condition: 'outcome', outcomeId: 'banner' });
  });

  it('re-authenticates once per run, then fails on the second expiry', () => {
    expect(nextMove({ kind: 'session_expired' }, FRESH)).toEqual({ move: 'reauthenticate_and_restart' });
    expect(nextMove({ kind: 'session_expired' }, { attempt: 0, reauthUsed: true })).toEqual({ move: 'fail', code: 'session_expired' });
  });

  it('fails hard on server errors, unresolved targets and unknown pages', () => {
    expect(nextMove({ kind: 'server_error' }, FRESH)).toEqual({ move: 'fail', code: 'server_error' });
    expect(nextMove({ kind: 'target_not_found' }, FRESH)).toEqual({ move: 'fail', code: 'target_not_found' });
    expect(nextMove({ kind: 'target_ambiguous' }, FRESH)).toEqual({ move: 'fail', code: 'target_ambiguous' });
    expect(nextMove({ kind: 'unknown' }, FRESH)).toEqual({ move: 'fail', code: 'checkpoint_failed' });
  });
});
