import { describe, expect, it } from 'vitest';
import { FAILURE_CODES, RecoverySchema } from '../../../src/models/execution-result';
import { dialogRecovery, humanCanRecover, nextMove, withDismissedDialogs } from '../../../src/logic/recovery';

const FRESH = { attempt: 0, reauthUsed: false, riskyStepDone: false };

describe('nextMove', () => {
  it('returns business outcomes as they are', () => {
    expect(nextMove({ kind: 'business', outcomeId: 'member_not_found' }, FRESH)).toEqual({
      move: 'return_business',
      outcomeId: 'member_not_found',
    });
  });

  it('retries a timeout twice with backoff, then fails', () => {
    expect(nextMove({ kind: 'timeout' }, FRESH)).toEqual({ move: 'retry_after', delayMs: 500, condition: 'timeout' });
    expect(nextMove({ kind: 'timeout' }, { ...FRESH, attempt: 1 })).toEqual({
      move: 'retry_after',
      delayMs: 1_000,
      condition: 'timeout',
    });
    expect(nextMove({ kind: 'timeout' }, { ...FRESH, attempt: 2 })).toEqual({ move: 'fail', code: 'timeout' });
  });

  it('keeps retrying timeouts after a risky step is done', () => {
    expect(nextMove({ kind: 'timeout' }, { ...FRESH, riskyStepDone: true })).toEqual({ move: 'retry_after', delayMs: 500, condition: 'timeout' });
  });

  it('applies a declared recovery at most twice', () => {
    const interstitial = { kind: 'recoverable', outcomeId: 'interstitial', recover: { kind: 'click', target: 'interstitial.continue' } } as const;

    expect(nextMove(interstitial, FRESH)).toEqual({ move: 'apply_recovery', outcomeId: 'interstitial', recover: interstitial.recover });
    expect(nextMove(interstitial, { ...FRESH, attempt: 2 })).toEqual({ move: 'fail', code: 'recovery_exhausted' });
    expect(nextMove({ kind: 'recoverable', outcomeId: 'banner' }, FRESH)).toEqual({ move: 'retry_after', delayMs: 500, condition: 'outcome', outcomeId: 'banner' });
  });

  it('re-authenticates once per run, then fails on the second expiry', () => {
    expect(nextMove({ kind: 'session_expired' }, FRESH)).toEqual({ move: 'reauthenticate_and_restart' });
    expect(nextMove({ kind: 'session_expired' }, { ...FRESH, reauthUsed: true })).toEqual({ move: 'fail', code: 'session_expired' });
  });

  it('refuses to restart once a risky step is done, saying why', () => {
    expect(nextMove({ kind: 'session_expired' }, { ...FRESH, riskyStepDone: true })).toEqual({
      move: 'fail',
      code: 'session_expired',
      note: 'not restarted: a risky step is already done and a restart would repeat it',
    });
  });

  it('fails hard on server errors, unresolved targets and unknown pages', () => {
    expect(nextMove({ kind: 'server_error' }, FRESH)).toEqual({ move: 'fail', code: 'server_error' });
    expect(nextMove({ kind: 'target_not_found' }, FRESH)).toEqual({ move: 'fail', code: 'target_not_found' });
    expect(nextMove({ kind: 'target_ambiguous' }, FRESH)).toEqual({ move: 'fail', code: 'target_ambiguous' });
    expect(nextMove({ kind: 'unknown' }, FRESH)).toEqual({ move: 'fail', code: 'checkpoint_failed' });
  });
});

describe('humanCanRecover', () => {
  it('offers a human only the failures where the page is not what the artifact expects', () => {
    expect(FAILURE_CODES.filter(humanCanRecover)).toEqual(['target_not_found', 'target_ambiguous', 'recovery_exhausted', 'checkpoint_failed']);
  });
});

describe('dismissed dialogs', () => {
  const dialog = { type: 'alert', message: 'Your session will expire soon' } as const;

  it('records a dialog as a valid recovery of the step', () => {
    const recovery = dialogRecovery('submit-search', dialog);

    expect(recovery).toEqual({ stepId: 'submit-search', condition: 'unexpected_dialog', response: 'dismissed', dialog });
    expect(RecoverySchema.parse(recovery)).toEqual(recovery);
  });

  it('adds each dialog to the observed text of a failure', () => {
    expect(withDismissedDialogs('text not visible', [])).toBe('text not visible');
    expect(withDismissedDialogs('text not visible', [dialog, { type: 'confirm', message: 'Leave?' }])).toBe(
      'text not visible; a alert dialog was dismissed: Your session will expire soon; a confirm dialog was dismissed: Leave?',
    );
  });
});
