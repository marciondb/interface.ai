import { describe, expect, it } from 'vitest';
import { evaluatePolicy, urlViolation } from '../../../src/logic/policy';
import type { Action } from '../../../src/models/action';
import type { Policy } from '../../../src/models/policy';
import type { ElementInfo } from '../../../src/models/resolution';

const POLICY: Policy = {
  allowedOrigins: ['http://localhost:8080'],
  allowedRoutes: ['/', '/welcome', '/member/*'],
  allowedActions: ['click', 'fill', 'select', 'navigate', 'read'],
  risky: { routes: ['/member/danger/*'], controlText: ['Close Account', 'Post Adjustment', 'Confirm'] },
};

const SHELL = 'http://localhost:8080/';
const DETAIL_FRAME = 'http://localhost:8080/member/detail?memberId=10001';

function click(): Action {
  return { verb: 'click', target: 'e1', argument: null, rationale: 'test' };
}

function navigate(url: string): Action {
  return { verb: 'navigate', target: null, argument: url, rationale: 'test' };
}

function linkTo(destination: string, frameUrl = 'http://localhost:8080/member/search') {
  return { role: 'link', name: 'x', frameUrl, destination };
}

function button(name: string, destination?: string): ElementInfo {
  return destination === undefined ? { role: 'button', name, frameUrl: DETAIL_FRAME } : { role: 'button', name, frameUrl: DETAIL_FRAME, destination };
}

describe('evaluatePolicy', () => {
  it('allows an allowlisted action on an allowlisted page and destination', () => {
    expect(evaluatePolicy({ action: click(), element: linkTo('http://localhost:8080/member/detail?memberId=1'), currentUrl: SHELL }, POLICY)).toEqual({
      decision: 'allow',
    });
  });

  it('allows filling the member id on the search screen', () => {
    const fill: Action = { verb: 'fill', target: 'e1', argument: '10001', rationale: 'test' };
    const element = { role: 'textbox', name: '', frameUrl: 'http://localhost:8080/member/search' };

    expect(evaluatePolicy({ action: fill, element, currentUrl: SHELL }, POLICY)).toEqual({ decision: 'allow' });
  });

  it('denies an action type outside the allowlist', () => {
    const press: Action = { verb: 'press', target: null, argument: 'Enter', rationale: 'test' };

    expect(evaluatePolicy({ action: press, currentUrl: SHELL }, POLICY)).toEqual({ decision: 'deny', reason: 'action press is not allowed' });
  });

  it('denies a page on another origin', () => {
    const decision = evaluatePolicy({ action: click(), currentUrl: 'http://evil.example/' }, POLICY);

    expect(decision).toEqual({ decision: 'deny', reason: 'current page: origin http://evil.example is not allowed' });
  });

  it('denies navigating to another origin', () => {
    expect(evaluatePolicy({ action: navigate('https://example.com/'), currentUrl: SHELL }, POLICY)).toEqual({
      decision: 'deny',
      reason: 'destination: origin https://example.com is not allowed',
    });
  });

  it('denies an element whose frame is on a route outside the allowlist', () => {
    const element = { role: 'button', name: 'Sign On', frameUrl: 'http://localhost:8080/login' };

    expect(evaluatePolicy({ action: click(), element, currentUrl: SHELL }, POLICY)).toMatchObject({
      decision: 'deny',
      reason: 'element frame: route /login is not allowed',
    });
  });

  it('denies a destination outside the allowlist before anything runs', () => {
    expect(evaluatePolicy({ action: click(), element: linkTo('http://localhost:8080/logout'), currentUrl: SHELL }, POLICY)).toMatchObject({
      decision: 'deny',
      reason: 'destination: route /logout is not allowed',
    });
    expect(evaluatePolicy({ action: navigate('http://localhost:8080/logout'), currentUrl: SHELL }, POLICY)).toEqual({
      decision: 'deny',
      reason: 'destination: route /logout is not allowed',
    });
    expect(evaluatePolicy({ action: navigate('http://other:9/member/search'), currentUrl: SHELL }, POLICY)).toMatchObject({ decision: 'deny' });
  });

  it.each(['Close Account', 'Post Adjustment', 'Confirm', '  close   account '])('requires a human for the risky control %j', (name) => {
    expect(evaluatePolicy({ action: click(), element: button(name), currentUrl: SHELL }, POLICY)).toEqual({
      decision: 'requires_human',
      reason: `control "${name.trim()}" is risky`,
    });
  });

  it('requires a human for a risky destination, even behind a harmless label', () => {
    const element = button('Go', 'http://localhost:8080/member/danger/close?memberId=10001');

    expect(evaluatePolicy({ action: click(), element, currentUrl: SHELL }, POLICY)).toEqual({
      decision: 'requires_human',
      reason: 'destination: route /member/danger/close is risky',
    });
    expect(evaluatePolicy({ action: navigate('http://localhost:8080/member/danger/adjust'), currentUrl: SHELL }, POLICY)).toMatchObject({
      decision: 'requires_human',
    });
  });

  it('lets deny win over requires_human', () => {
    const element = { role: 'button', name: 'Close Account', frameUrl: DETAIL_FRAME, destination: 'http://localhost:8080/logout' };
    const narrow: Policy = { ...POLICY, allowedRoutes: ['/', '/member/detail'] };

    expect(evaluatePolicy({ action: click(), element, currentUrl: SHELL }, POLICY)).toMatchObject({ decision: 'deny' });
    expect(evaluatePolicy({ action: navigate('http://localhost:8080/member/danger/close'), currentUrl: SHELL }, narrow)).toEqual({
      decision: 'deny',
      reason: 'destination: route /member/danger/close is not allowed',
    });
  });

  it('allows controls that only look like risky ones', () => {
    for (const name of ['Open Sub-Account', 'Continue', 'Confirmation details', 'Close']) {
      expect(evaluatePolicy({ action: click(), element: button(name), currentUrl: SHELL }, POLICY)).toEqual({ decision: 'allow' });
    }
  });

  it('allows reading a risky control, since reading never changes the page', () => {
    const read: Action = { verb: 'read', target: 'e1', argument: 'label', rationale: 'test' };

    expect(evaluatePolicy({ action: read, element: button('Close Account'), currentUrl: SHELL }, POLICY)).toEqual({ decision: 'allow' });
  });

  it('matches routes exactly unless they end with *', () => {
    expect(urlViolation('http://localhost:8080/', POLICY)).toBeUndefined();
    expect(urlViolation('http://localhost:8080/welcome', POLICY)).toBeUndefined();
    expect(urlViolation('http://localhost:8080/member/', POLICY)).toBeUndefined();
    expect(urlViolation('http://localhost:8080/member/danger/close?memberId=1', POLICY)).toBeUndefined();
    expect(urlViolation('http://localhost:8080/welcome/more', POLICY)).toBe('route /welcome/more is not allowed');
    expect(urlViolation('http://localhost:8080/members', POLICY)).toBe('route /members is not allowed');
    expect(urlViolation('not a url', POLICY)).toBe('not a url is not a valid URL');
  });
});
