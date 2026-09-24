import { describe, expect, it, vi } from 'vitest';
import { createActionGateway } from '../../../../src/diplomat/gateway/action-gateway';
import type { SurfaceDriver } from '../../../../src/diplomat/surface/port';
import type { Action } from '../../../../src/models/action';
import type { ControlOwner } from '../../../../src/models/control';
import type { Policy } from '../../../../src/models/policy';
import type { ElementInfo } from '../../../../src/models/resolution';
import { emptyObservation } from '../../../support/observations';

const POLICY: Policy = {
  allowedOrigins: ['http://localhost:8080'],
  allowedRoutes: ['/', '/member/*'],
  allowedActions: ['click', 'read'],
  risky: { routes: ['/member/danger/*'], controlText: ['Close Account'] },
};

function fakeDriver(element: ElementInfo) {
  const calls: string[] = [];
  const driver: SurfaceDriver = {
    open: (url) => {
      calls.push(`open ${url}`);
      return Promise.resolve();
    },
    observe: () => Promise.resolve(emptyObservation()),
    resolve: () => Promise.resolve({ status: 'unresolved', counts: [] }),
    perform: (action, options) => {
      calls.push(`perform ${action.verb} ${String(options?.timeoutMs)}`);
      return Promise.resolve({ status: 'done', navigations: [] });
    },
    describe: () => Promise.resolve(element),
    inspect: () => Promise.resolve({ attributes: {} }),
    currentUrl: () => 'http://localhost:8080/',
    screenshot: () => Promise.resolve(new Uint8Array()),
    close: () => Promise.resolve(),
  };
  return { driver, calls };
}

function gatewayOf(driver: SurfaceDriver, policy: Policy = POLICY, owner: ControlOwner = 'automation') {
  return createActionGateway({ driver, policy, controlOwner: () => owner });
}

function click(): Action {
  return { verb: 'click', target: 'e1', argument: null, rationale: 'test' };
}

const SEARCH_FRAME = 'http://localhost:8080/member/search';

describe('action gateway', () => {
  it('performs allowed actions with the requested timeout', async () => {
    const { driver, calls } = fakeDriver({ role: 'link', name: 'Detail', frameUrl: SEARCH_FRAME, destination: `${SEARCH_FRAME}?x=1` });

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
    const fill: Action = { verb: 'fill', target: 'e1', argument: '1', rationale: 'test' };

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

  it('opens only allowlisted, non-risky URLs', async () => {
    const { driver, calls } = fakeDriver({ role: 'x', name: '', frameUrl: SEARCH_FRAME });
    const gateway = gatewayOf(driver, { ...POLICY, allowedActions: ['navigate'] });

    expect(await gateway.open('http://localhost:8080/', [])).toEqual({ decision: 'allow' });
    expect(await gateway.open('http://localhost:9999/', [])).toMatchObject({ decision: 'deny' });
    expect(await gateway.open('http://localhost:8080/member/danger/close', [])).toMatchObject({ decision: 'requires_human' });
    expect(calls).toEqual(['open http://localhost:8080/']);
  });

  it('refuses every action but reading while a human holds control, before asking the policy', async () => {
    const { driver, calls } = fakeDriver({ role: 'link', name: 'Detail', frameUrl: SEARCH_FRAME, destination: `${SEARCH_FRAME}?x=1` });
    const described = vi.spyOn(driver, 'describe');
    const gateway = gatewayOf(driver, POLICY, 'human');
    const read: Action = { verb: 'read', target: 'e1', argument: 'balance', rationale: 'test' };

    expect(await gateway.perform({ stepId: 's', purpose: 'step', action: click(), timeoutMs: 1 })).toEqual({
      status: 'denied',
      reason: 'control_owned_by_human',
    });
    expect(await gateway.open('http://localhost:8080/', [])).toEqual({ decision: 'deny', reason: 'control_owned_by_human' });
    expect(described).toHaveBeenCalledTimes(0);
    expect(calls).toEqual([]);
    expect(await gateway.perform({ stepId: 's', purpose: 'checkpoint', action: read, timeoutMs: 1 })).toMatchObject({ status: 'done' });
    expect(calls).toEqual(['perform read 1']);
  });
});
