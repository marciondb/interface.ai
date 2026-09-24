import { describe, expect, it } from 'vitest';
import { evaluatePolicy, urlViolation } from '../../../src/logic/policy';
import type { Action } from '../../../src/models/action';
import type { Policy } from '../../../src/models/policy';

const POLICY: Policy = {
  allowedOrigins: ['http://localhost:8080'],
  allowedRoutes: ['/', '/welcome', '/member/*'],
  allowedActions: ['click', 'fill', 'select', 'navigate', 'read'],
};

const SHELL = 'http://localhost:8080/';

function click(): Action {
  return { verb: 'click', target: 'e1', argument: null, rationale: 'test' };
}

function linkTo(destination: string, frameUrl = 'http://localhost:8080/member/search') {
  return { role: 'link', name: 'x', frameUrl, destination };
}

describe('evaluatePolicy', () => {
  it('allows an allowlisted action on an allowlisted page and destination', () => {
    expect(evaluatePolicy({ action: click(), element: linkTo('http://localhost:8080/member/detail?memberId=1'), currentUrl: SHELL }, POLICY)).toEqual({
      decision: 'allow',
    });
  });

  it('denies an action type outside the allowlist', () => {
    const press: Action = { verb: 'press', target: null, argument: 'Enter', rationale: 'test' };

    expect(evaluatePolicy({ action: press, currentUrl: SHELL }, POLICY)).toEqual({ decision: 'deny', reason: 'action press is not allowed' });
  });

  it('denies a page on another origin', () => {
    const decision = evaluatePolicy({ action: click(), currentUrl: 'http://evil.example/' }, POLICY);

    expect(decision).toEqual({ decision: 'deny', reason: 'current page: origin http://evil.example is not allowed' });
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
    const navigate: Action = { verb: 'navigate', target: null, argument: 'http://other:9/member/search', rationale: 'test' };
    expect(evaluatePolicy({ action: navigate, currentUrl: SHELL }, POLICY)).toMatchObject({ decision: 'deny' });
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
