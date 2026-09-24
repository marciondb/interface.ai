import { describe, expect, it } from 'vitest';
import { createActionGateway } from '../../../../src/diplomat/gateway/action-gateway';
import type { SurfaceDriver } from '../../../../src/diplomat/surface/port';
import type { Action } from '../../../../src/models/action';
import type { Policy } from '../../../../src/models/policy';
import type { ElementInfo } from '../../../../src/models/resolution';
import { emptyObservation } from '../../../support/observations';

const POLICY: Policy = {
  allowedOrigins: ['http://localhost:8080'],
  allowedRoutes: ['/', '/member/*'],
  allowedActions: ['click', 'read'],
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
    currentUrl: () => 'http://localhost:8080/',
    screenshot: () => Promise.resolve(new Uint8Array()),
    close: () => Promise.resolve(),
  };
  return { driver, calls };
}

function click(): Action {
  return { verb: 'click', target: 'e1', argument: null, rationale: 'test' };
}

const SEARCH_FRAME = 'http://localhost:8080/member/search';

describe('action gateway', () => {
  it('performs allowed actions with the requested timeout', async () => {
    const { driver, calls } = fakeDriver({ role: 'link', name: 'Detail', frameUrl: SEARCH_FRAME, destination: `${SEARCH_FRAME}?x=1` });

    const outcome = await createActionGateway({ driver, policy: POLICY }).perform({ stepId: 's', purpose: 'step', action: click(), timeoutMs: 1234 });

    expect(outcome).toEqual({ status: 'done', navigations: [] });
    expect(calls).toEqual(['perform click 1234']);
  });

  it('denies without calling the driver when the destination is outside the allowlist', async () => {
    const { driver, calls } = fakeDriver({ role: 'link', name: 'Sign Off', frameUrl: SEARCH_FRAME, destination: 'http://localhost:8080/logout' });

    const outcome = await createActionGateway({ driver, policy: POLICY }).perform({ stepId: 's', purpose: 'step', action: click(), timeoutMs: 1 });

    expect(outcome).toEqual({ status: 'denied', reason: 'destination: route /logout is not allowed' });
    expect(calls).toEqual([]);
  });

  it('denies verbs outside the allowlist', async () => {
    const { driver, calls } = fakeDriver({ role: 'textbox', name: '', frameUrl: SEARCH_FRAME });
    const fill: Action = { verb: 'fill', target: 'e1', argument: '1', rationale: 'test' };

    const outcome = await createActionGateway({ driver, policy: POLICY }).perform({ stepId: 's', purpose: 'step', action: fill, timeoutMs: 1 });

    expect(outcome).toMatchObject({ status: 'denied' });
    expect(calls).toEqual([]);
  });

  it('opens only allowlisted URLs', async () => {
    const { driver, calls } = fakeDriver({ role: 'x', name: '', frameUrl: SEARCH_FRAME });
    const gateway = createActionGateway({ driver, policy: { ...POLICY, allowedActions: ['navigate'] } });

    expect(await gateway.open('http://localhost:8080/', [])).toEqual({ decision: 'allow' });
    expect(await gateway.open('http://localhost:9999/', [])).toMatchObject({ decision: 'deny' });
    expect(calls).toEqual(['open http://localhost:8080/']);
  });
});
