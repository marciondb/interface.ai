import { describe, expect, it } from 'vitest';
import {
  afterAction,
  afterLanding,
  afterRecoveryAction,
  conditionDismissed,
  gateRiskyStep,
  servedServerError,
} from '../../../src/logic/step-attempt';

const LANDING = { reason: 'landed_outside_allowlist', landedAt: 'http://localhost:8080/login' } as const;

describe('gateRiskyStep', () => {
  it('fails a risky step the policy denies rather than handing it to a human', () => {
    expect(gateRiskyStep('close', 'click on account.close', { decision: 'deny', reason: 'route not allowed' })).toEqual({
      kind: 'failed',
      code: 'policy_denied',
      expected: 'click on account.close allowed by policy',
      observed: 'route not allowed',
    });
  });

  it('hands a risky step to a human whether or not the policy also calls it risky', () => {
    const human = { kind: 'requires_human', message: 'step close is risky: click on account.close needs a human' };

    expect(gateRiskyStep('close', 'click on account.close', { decision: 'allow' })).toEqual(human);
    expect(gateRiskyStep('close', 'click on account.close', { decision: 'requires_human', reason: 'risky control' })).toEqual(human);
  });
});

describe('servedServerError', () => {
  it('is true only when a navigation answered with HTTP 500 or above', () => {
    expect(servedServerError([])).toBe(false);
    expect(servedServerError([{ url: 'http://a/', status: 200 }, { url: 'http://a/x', status: 499 }])).toBe(false);
    expect(servedServerError([{ url: 'http://a/', status: 302 }, { url: 'http://a/x', status: 500 }])).toBe(true);
  });
});

describe('afterAction', () => {
  const what = 'click on lookup.search';

  it('maps refusals and driver errors to hard failures', () => {
    expect(afterAction({ status: 'denied', reason: 'control_owned_by_human' }, what, 2_000)).toEqual({
      kind: 'failed',
      code: 'policy_denied',
      expected: 'click on lookup.search allowed by policy',
      observed: 'control_owned_by_human',
    });
    expect(afterAction({ status: 'error', message: 'element detached' }, what, 2_000)).toEqual({
      kind: 'failed',
      code: 'driver_error',
      expected: 'click on lookup.search to complete',
      observed: 'element detached',
    });
  });

  it('hands a risky action to a human', () => {
    expect(afterAction({ status: 'requires_human', reason: 'risky control text' }, what, 2_000)).toEqual({
      kind: 'requires_human',
      message: 'click on lookup.search needs a human: risky control text',
    });
  });

  it('leaves a landing and a timeout to be looked at on the page', () => {
    expect(afterAction({ status: 'landed_outside_policy', ...LANDING }, what, 2_000)).toEqual({ kind: 'landed', landing: { status: 'landed_outside_policy', ...LANDING } });
    expect(afterAction({ status: 'timeout' }, what, 2_000)).toEqual({
      kind: 'timed_out',
      expected: 'click on lookup.search to finish loading within 2000 ms',
      observed: 'still loading after 2000 ms',
    });
  });

  it('verifies a completed action, carrying the value read and any server error', () => {
    expect(afterAction({ status: 'done', navigations: [] }, what, 2_000)).toEqual({ kind: 'verify', serverError: false });
    expect(afterAction({ status: 'done', value: '4,812.37', navigations: [{ url: 'http://a/', status: 503 }] }, 'read on detail.balance', 2_000)).toEqual({
      kind: 'verify',
      value: '4,812.37',
      serverError: true,
    });
  });
});

describe('afterLanding', () => {
  it('treats landing on the sign-in page as an expired session', () => {
    expect(afterLanding(true, 'click on lookup.search', LANDING)).toEqual({
      kind: 'session_expired',
      expected: 'click on lookup.search to keep the session',
      observed: 'landed_outside_allowlist at http://localhost:8080/login',
    });
  });

  it('fails anywhere else outside the policy', () => {
    expect(afterLanding(false, 'click on lookup.search', LANDING)).toMatchObject({
      kind: 'failed',
      code: 'policy_denied',
      expected: 'click on lookup.search to stay within the policy',
    });
  });
});

describe('afterRecoveryAction', () => {
  it('retries the step after the control was clicked, even if the page is still loading', () => {
    expect(afterRecoveryAction({ status: 'done', navigations: [] }, 'interstitial.continue')).toEqual({ kind: 'retry' });
    expect(afterRecoveryAction({ status: 'timeout' }, 'interstitial.continue')).toEqual({ kind: 'retry' });
  });

  it('fails on a refusal or a driver error and hands a risky control to a human', () => {
    expect(afterRecoveryAction({ status: 'landed_outside_policy', ...LANDING }, 'interstitial.continue')).toMatchObject({ kind: 'failed', code: 'policy_denied' });
    expect(afterRecoveryAction({ status: 'error', message: 'boom' }, 'interstitial.continue')).toMatchObject({ kind: 'failed', code: 'driver_error' });
    expect(afterRecoveryAction({ status: 'requires_human', reason: 'risky' }, 'interstitial.continue')).toEqual({
      kind: 'requires_human',
      message: 'click on interstitial.continue needs a human: risky',
    });
  });
});

describe('conditionDismissed', () => {
  it('holds once the condition no longer shows, or when it declares no detector', () => {
    expect(conditionDismissed('interstitial', undefined)).toEqual({ held: true });
    expect(conditionDismissed('interstitial', { holds: false, expected: 'x', observed: 'text not visible' })).toEqual({ held: true });
  });

  it('does not hold while the condition still shows', () => {
    expect(conditionDismissed('interstitial', { holds: true, expected: 'x', observed: 'text visible' })).toEqual({
      held: false,
      expected: 'interstitial to be dismissed',
      observed: 'text visible',
    });
  });
});
