import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluateLanding, evaluatePolicy, urlViolation } from '../../../src/logic/policy';
import type { SurfaceAction } from '../../../src/models/action';
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

function click(): SurfaceAction {
  return { kind: 'click', ref: 'e1' };
}

function navigate(url: string): SurfaceAction {
  return { kind: 'navigate', url };
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
    const fill: SurfaceAction = { kind: 'fill', ref: 'e1', value: '10001' };
    const element = { role: 'textbox', name: '', frameUrl: 'http://localhost:8080/member/search' };

    expect(evaluatePolicy({ action: fill, element, currentUrl: SHELL }, POLICY)).toEqual({ decision: 'allow' });
  });

  it('denies an action type outside the allowlist', () => {
    const press: SurfaceAction = { kind: 'press', ref: 'e1', key: 'Enter' };

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
    const read: SurfaceAction = { kind: 'read', ref: 'e1' };

    expect(evaluatePolicy({ action: read, element: button('Close Account'), currentUrl: SHELL }, POLICY)).toEqual({ decision: 'allow' });
  });

  it('requires a human when the element sits in a frame showing a risky page, though the top page is not', () => {
    const element = { role: 'link', name: 'Return to Member Detail', frameUrl: 'http://localhost:8080/member/danger/close' };

    expect(evaluatePolicy({ action: click(), element, currentUrl: SHELL }, POLICY)).toEqual({
      decision: 'requires_human',
      reason: 'element frame: route /member/danger/close is risky',
    });
  });

  it.each(['Yes, confirm', 'Confirm ›', 'Con\u200bfirm', 'ＣＯＮＦＩＲＭ', 'close\u00a0account now'])('requires a human for %j, which mentions a risky control', (name) => {
    expect(evaluatePolicy({ action: click(), element: button(name), currentUrl: SHELL }, POLICY)).toMatchObject({ decision: 'requires_human' });
  });

  it('looks for risky control text in every label the element shows, not only its name', () => {
    const imageOnly: ElementInfo = { role: 'button', name: '', texts: ['Confirm'], frameUrl: DETAIL_FRAME };
    const titled: ElementInfo = { role: 'button', name: 'Next', texts: ['Next', 'Close Account'], frameUrl: DETAIL_FRAME };

    expect(evaluatePolicy({ action: click(), element: imageOnly, currentUrl: SHELL }, POLICY)).toEqual({
      decision: 'requires_human',
      reason: 'control "Confirm" is risky',
    });
    expect(evaluatePolicy({ action: click(), element: titled, currentUrl: SHELL }, POLICY)).toMatchObject({ decision: 'requires_human' });
  });

  it('checks a key press on a control like a click', () => {
    const withPress: Policy = { ...POLICY, allowedActions: [...POLICY.allowedActions, 'press'] };
    const press: SurfaceAction = { kind: 'press', ref: 'e1', key: 'Enter' };

    expect(evaluatePolicy({ action: press, element: button('Confirm'), currentUrl: SHELL }, withPress)).toMatchObject({
      decision: 'requires_human',
    });
    expect(evaluatePolicy({ action: press, element: button('Go', 'http://localhost:8080/member/danger/close'), currentUrl: SHELL }, withPress)).toMatchObject({
      decision: 'requires_human',
    });
  });

  it.each([
    'http://localhost:8080/member/danger',
    'http://localhost:8080/member//danger/close',
    'http://localhost:8080/member/Danger/close',
    'http://localhost:8080/member/%64anger/close',
    'http://localhost:8080/member/danger;x/close',
  ])('recognizes the risky route behind %s', (url) => {
    expect(evaluatePolicy({ action: navigate(url), currentUrl: SHELL }, POLICY)).toMatchObject({ decision: 'requires_human' });
  });

  it.each(['http://localhost:8080/member/..%2flogout', 'http://localhost:8080/member/%2e%2e%5clogout', 'http://localhost:8080/member/%2fdanger/close'])(
    'denies %s, whose segments decode to separators or dot segments',
    (url) => {
      expect(evaluatePolicy({ action: navigate(url), currentUrl: SHELL }, POLICY)).toMatchObject({ decision: 'deny' });
    },
  );

  it('denies URLs carrying credentials', () => {
    const withUserAndPassword = new URL('http://localhost:8080/');
    withUserAndPassword.username = `user-${randomUUID()}`;
    withUserAndPassword.password = randomUUID();
    const withUserOnly = new URL('http://localhost:8080/member/search');
    withUserOnly.username = `user-${randomUUID()}`;

    expect(urlViolation(withUserAndPassword.href, POLICY)).toBe('credentials in the URL are not allowed');
    expect(urlViolation(withUserOnly.href, POLICY)).toBe('credentials in the URL are not allowed');
  });

  it('matches routes exactly unless they end with *', () => {
    expect(urlViolation('http://localhost:8080/', POLICY)).toBeUndefined();
    expect(urlViolation('http://localhost:8080/welcome', POLICY)).toBeUndefined();
    expect(urlViolation('http://localhost:8080/member/', POLICY)).toBeUndefined();
    expect(urlViolation('http://localhost:8080/member/danger/close?memberId=1', POLICY)).toBeUndefined();
    expect(urlViolation('http://localhost:8080/welcome/more', POLICY)).toBe('route /welcome/more is not allowed');
    expect(urlViolation('http://localhost:8080/members', POLICY)).toBe('route /members is not allowed');
    expect(urlViolation('not a url', POLICY)).toBe('not a url is not a valid URL');
    expect(urlViolation('http://localhost:8080/member', POLICY)).toBeUndefined();
  });
});

describe('evaluateLanding', () => {
  const DANGER = 'http://localhost:8080/member/danger/close?memberId=1';

  it('accepts a landing inside the allowlist, empty frames included', () => {
    expect(evaluateLanding({ loaded: [DETAIL_FRAME], frames: [SHELL, DETAIL_FRAME, 'about:blank'], before: [SHELL] }, POLICY)).toBeUndefined();
  });

  it('rejects any loaded URL or frame outside the allowlist', () => {
    expect(evaluateLanding({ loaded: ['http://localhost:8080/logout', DETAIL_FRAME], frames: [SHELL], before: [SHELL] }, POLICY)).toEqual({
      reason: 'landed_outside_allowlist',
      landedAt: 'http://localhost:8080/logout',
    });
    expect(evaluateLanding({ loaded: [], frames: [SHELL, 'chrome-error://chromewebdata/'], before: [SHELL] }, POLICY)).toMatchObject({
      reason: 'landed_outside_allowlist',
    });
  });

  it('rejects a risky route the action loaded or moved a frame to, but not one a frame was already on', () => {
    expect(evaluateLanding({ loaded: [DANGER], frames: [SHELL], before: [SHELL] }, POLICY)).toEqual({ reason: 'landed_on_risky_route', landedAt: DANGER });
    expect(evaluateLanding({ loaded: [], frames: [SHELL, DANGER], before: [SHELL, DETAIL_FRAME] }, POLICY)).toMatchObject({ reason: 'landed_on_risky_route' });
    expect(evaluateLanding({ loaded: [], frames: [SHELL, DANGER], before: [SHELL, DANGER] }, POLICY)).toBeUndefined();
  });
});
