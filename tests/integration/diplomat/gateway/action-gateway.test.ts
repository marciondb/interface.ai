import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createActionGateway } from '../../../../src/diplomat/gateway/action-gateway';
import { CONTROL_OWNED_BY_HUMAN } from '../../../../src/diplomat/gateway/port';
import type { SurfaceDriver } from '../../../../src/diplomat/surface/port';
import type { SurfaceAction } from '../../../../src/models/action';
import type { ControlOwner } from '../../../../src/models/control';
import type { Policy } from '../../../../src/models/policy';
import type { ElementInfo, PerformOutcome } from '../../../../src/models/resolution';
import { emptyObservation } from '../../../support/observations';

const POLICY: Policy = {
  allowedOrigins: ['http://localhost:8080'],
  allowedRoutes: ['/', '/member/*'],
  allowedActions: ['click', 'read'],
  risky: { routes: ['/member/danger/*'], controlText: ['Close Account'] },
};

const SHELL = 'http://localhost:8080/';

type FakeOptions = {
  // Frame URLs before the driver acts (default: the shell and the search frame) and after.
  readonly framesBefore?: readonly string[];
  readonly framesAfter?: readonly string[];
  readonly outcome?: PerformOutcome;
};

function fakeDriver(element: ElementInfo, options: FakeOptions = {}) {
  const calls: string[] = [];
  let frames: readonly string[] = options.framesBefore ?? [SHELL, SEARCH_FRAME];
  let guard: ((url: string) => boolean) | undefined;
  const driver: SurfaceDriver = {
    open: (url) => {
      calls.push(`open ${url}`);
      frames = options.framesAfter ?? [url];
      return Promise.resolve();
    },
    observe: () => Promise.resolve(emptyObservation()),
    resolve: () => Promise.resolve({ status: 'unresolved', counts: [] }),
    perform: (action, performOptions) => {
      calls.push(`perform ${action.kind} ${String(performOptions?.timeoutMs)}`);
      frames = options.framesAfter ?? frames;
      return Promise.resolve(options.outcome ?? { status: 'done', navigations: [] });
    },
    describe: () => Promise.resolve(element),
    inspect: () => Promise.resolve({ attributes: {} }),
    currentUrl: () => frames[0] ?? '',
    frameUrls: () => frames,
    setNavigationGuard: (allows) => {
      guard = allows;
    },
    screenshot: (screenshotOptions) => {
      calls.push(`screenshot ${JSON.stringify(screenshotOptions?.maskTexts ?? null)}`);
      return Promise.resolve(new Uint8Array([1]));
    },
    close: () => Promise.resolve(),
  };
  return { driver, calls, guard: () => guard };
}

function gatewayOf(driver: SurfaceDriver, policy: Policy = POLICY, owner: ControlOwner = 'automation') {
  return createActionGateway({ driver, policy, controlOwner: () => owner });
}

function click(): SurfaceAction {
  return { kind: 'click', ref: 'e1' };
}

const SEARCH_FRAME = 'http://localhost:8080/member/search';
const DETAIL = { role: 'link', name: 'Detail', frameUrl: SEARCH_FRAME, destination: `${SEARCH_FRAME}?x=1` };

describe('action gateway', () => {
  it('performs allowed actions with the requested timeout', async () => {
    const { driver, calls } = fakeDriver(DETAIL);

    const outcome = await gatewayOf(driver).perform({ stepId: 's', purpose: 'step', action: click(), timeoutMs: 1234 });

    expect(outcome).toEqual({ status: 'done', navigations: [] });
    expect(calls).toEqual(['perform click 1234']);
  });

  it('denies without calling the driver when the destination is outside the allowlist', async () => {
    const { driver, calls } = fakeDriver({ role: 'link', name: 'Sign Off', frameUrl: SEARCH_FRAME, destination: 'http://localhost:8080/logout' });

    const outcome = await gatewayOf(driver).perform({ stepId: 's', purpose: 'step', action: click(), timeoutMs: 1 });

    expect(outcome).toEqual({ status: 'denied', reason: 'destination: route /logout is not allowed' });
    expect(calls).toEqual([]);
  });

  it('denies verbs outside the allowlist', async () => {
    const { driver, calls } = fakeDriver({ role: 'textbox', name: '', frameUrl: SEARCH_FRAME });
    const fill: SurfaceAction = { kind: 'fill', ref: 'e1', value: '1' };

    const outcome = await gatewayOf(driver).perform({ stepId: 's', purpose: 'step', action: fill, timeoutMs: 1 });

    expect(outcome).toMatchObject({ status: 'denied' });
    expect(calls).toEqual([]);
  });

  it('requires a human without calling the driver for a risky control', async () => {
    const { driver, calls } = fakeDriver({
      role: 'button',
      name: 'Close Account',
      frameUrl: 'http://localhost:8080/member/detail?memberId=10001',
      destination: 'http://localhost:8080/member/danger/close?memberId=10001',
    });

    const outcome = await gatewayOf(driver).perform({ stepId: 's', purpose: 'step', action: click(), timeoutMs: 1 });

    expect(outcome).toEqual({ status: 'requires_human', reason: 'destination: route /member/danger/close is risky' });
    expect(calls).toEqual([]);
  });

  it('checks an action without performing it', async () => {
    const { driver, calls } = fakeDriver({ role: 'link', name: 'Sign Off', frameUrl: SEARCH_FRAME, destination: 'http://localhost:8080/logout' });

    expect(await gatewayOf(driver).check(click())).toEqual({ decision: 'deny', reason: 'destination: route /logout is not allowed' });
    expect(calls).toEqual([]);
  });

  it('opens only allowlisted, non-risky URLs', async () => {
    const { driver, calls } = fakeDriver({ role: 'x', name: '', frameUrl: SEARCH_FRAME });
    const gateway = gatewayOf(driver, { ...POLICY, allowedActions: ['navigate'] });

    expect(gateway.checkOpen('http://localhost:9999/')).toMatchObject({ decision: 'deny' });
    const withCredentials = new URL('http://localhost:8080/');
    withCredentials.username = `user-${randomUUID()}`;
    withCredentials.password = randomUUID();
    expect(gateway.checkOpen(withCredentials.href)).toEqual({
      decision: 'deny',
      reason: 'current page: credentials in the URL are not allowed',
    });
    expect(await gateway.open('http://localhost:8080/', [])).toEqual({ decision: 'allow' });
    expect(await gateway.open('http://localhost:9999/', [])).toMatchObject({ decision: 'deny' });
    expect(await gateway.open('http://localhost:8080/member/danger/close', [])).toMatchObject({ decision: 'requires_human' });
    expect(calls).toEqual(['open http://localhost:8080/']);
  });

  it('reports an open that lands outside the allowlist', async () => {
    const { driver } = fakeDriver({ role: 'x', name: '', frameUrl: SEARCH_FRAME }, { framesAfter: [SHELL, 'http://evil.example/'] });

    expect(await gatewayOf(driver, { ...POLICY, allowedActions: ['navigate'] }).open(SHELL, [])).toEqual({
      decision: 'landed_outside_policy',
      reason: 'landed_outside_allowlist',
      landedAt: 'http://evil.example/',
    });
  });

  it('reports, after the driver acted, an action whose page ended up outside the allowlist', async () => {
    const { driver, calls } = fakeDriver(DETAIL, { framesAfter: [SHELL, 'http://evil.example/steal'] });

    const outcome = await gatewayOf(driver).perform({ stepId: 's', purpose: 'step', action: click(), timeoutMs: 1 });

    expect(outcome).toEqual({ status: 'landed_outside_policy', reason: 'landed_outside_allowlist', landedAt: 'http://evil.example/steal' });
    expect(calls).toEqual(['perform click 1']);
  });

  it('reports an action that redirected through a URL outside the allowlist, even when it came back', async () => {
    const navigations = [
      { url: 'http://localhost:8080/logout', status: 302 },
      { url: SEARCH_FRAME, status: 200 },
    ];
    const { driver } = fakeDriver(DETAIL, { outcome: { status: 'done', navigations } });

    expect(await gatewayOf(driver).perform({ stepId: 's', purpose: 'step', action: click(), timeoutMs: 1 })).toEqual({
      status: 'landed_outside_policy',
      reason: 'landed_outside_allowlist',
      landedAt: 'http://localhost:8080/logout',
    });
  });

  it('reports an action that took a frame to a risky route, even after a timeout', async () => {
    const danger = 'http://localhost:8080/member/danger/close?memberId=1';
    const { driver } = fakeDriver(DETAIL, { framesAfter: [SHELL, danger], outcome: { status: 'timeout' } });

    expect(await gatewayOf(driver).perform({ stepId: 's', purpose: 'step', action: click(), timeoutMs: 1 })).toEqual({
      status: 'landed_outside_policy',
      reason: 'landed_on_risky_route',
      landedAt: danger,
    });
  });

  it('ignores empty frames and risky pages the action did not move a frame to', async () => {
    const danger = 'http://localhost:8080/member/danger/close?memberId=1';
    const { driver } = fakeDriver({ role: 'link', name: 'Home', frameUrl: SHELL, destination: SHELL }, { framesAfter: [SHELL, 'about:blank'] });
    const gateway = gatewayOf(driver);

    expect(await gateway.perform({ stepId: 's', purpose: 'step', action: click(), timeoutMs: 1 })).toMatchObject({ status: 'done' });

    const stays = fakeDriver({ role: 'link', name: 'Home', frameUrl: SHELL, destination: SHELL }, { framesBefore: [SHELL, danger] });
    expect(await gatewayOf(stays.driver).perform({ stepId: 's', purpose: 'step', action: click(), timeoutMs: 1 })).toMatchObject({ status: 'done' });
  });

  it('does not judge where a read landed, since reading never moves the page', async () => {
    const { driver } = fakeDriver(DETAIL, { framesAfter: [SHELL, 'http://localhost:8080/member/danger/close'] });
    const read: SurfaceAction = { kind: 'read', ref: 'e1' };

    expect(await gatewayOf(driver).perform({ stepId: 's', purpose: 'checkpoint', action: read, timeoutMs: 1 })).toMatchObject({ status: 'done' });
  });

  it('installs a navigation guard that admits only the allowlist', () => {
    const { driver, guard } = fakeDriver(DETAIL);
    gatewayOf(driver);

    const allows = guard();
    expect(allows?.('http://localhost:8080/member/detail?memberId=1')).toBe(true);
    expect(allows?.('http://localhost:8080/member/danger/close')).toBe(true);
    expect(allows?.('http://localhost:8080/logout')).toBe(false);
    expect(allows?.('http://evil.example/')).toBe(false);
  });

  it('passes screenshot masks through to the driver', async () => {
    const { driver, calls } = fakeDriver(DETAIL);
    const gateway = gatewayOf(driver);

    expect(await gateway.screenshot({ maskTexts: ['10001', 'Jane'] })).toEqual(new Uint8Array([1]));
    await gateway.screenshot();

    expect(calls).toEqual(['screenshot ["10001","Jane"]', 'screenshot null']);
  });

  it('refuses every action but reading while a human holds control, before asking the policy', async () => {
    const { driver, calls } = fakeDriver(DETAIL);
    const described = vi.spyOn(driver, 'describe');
    const gateway = gatewayOf(driver, POLICY, 'human');
    const read: SurfaceAction = { kind: 'read', ref: 'e1' };

    expect(await gateway.perform({ stepId: 's', purpose: 'step', action: click(), timeoutMs: 1 })).toEqual({
      status: 'denied',
      reason: CONTROL_OWNED_BY_HUMAN,
    });
    expect(await gateway.open('http://localhost:8080/', [])).toEqual({ decision: 'deny', reason: CONTROL_OWNED_BY_HUMAN });
    expect(described).toHaveBeenCalledTimes(0);
    expect(calls).toEqual([]);
    expect(await gateway.perform({ stepId: 's', purpose: 'checkpoint', action: read, timeoutMs: 1 })).toMatchObject({ status: 'done' });
    expect(calls).toEqual(['perform read 1']);
  });
});
