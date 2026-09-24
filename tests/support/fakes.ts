import type { Escalation, HandoffRequest } from '../../src/controllers/escalation';
import type { CapturePaths, EvidenceRecorder } from '../../src/diplomat/evidence/port';
import type { ActionGateway, GatewayOutcome, GatewayRequest, OpenDecision } from '../../src/diplomat/gateway/port';
import type { SessionErrorCode, SessionProvider } from '../../src/diplomat/session/port';
import type { ArtifactStore, LoadResult } from '../../src/diplomat/store/port';
import type { ScreenshotOptions, SurfaceErrorCode, SurfaceFault } from '../../src/diplomat/surface/port';
import type { Clock } from '../../src/infrastructure/clock';
import type { SensitiveValue } from '../../src/logic/redaction';
import type { SurfaceAction } from '../../src/models/action';
import type { Capability, TargetSpec } from '../../src/models/capability';
import type { DiscoveryResult } from '../../src/models/discovery';
import type { EscalationReason, ExecutionResult } from '../../src/models/execution-result';
import type { InterventionRequest } from '../../src/models/intervention';
import type { Dialog, Observation } from '../../src/models/observation';
import type { PolicyDecision } from '../../src/models/policy';
import type { RunEvent } from '../../src/models/run-event';

// A rejection as the surface port defines it.
export function surfaceFault(code: SurfaceErrorCode, detail: string): SurfaceFault {
  return Object.assign(new Error(`surface ${code}: ${detail}`), { name: 'SurfaceError' as const, code });
}

// Fast, browser-free stand-ins for the ports a controller uses, scripted by the test.

export const FAKE_ORIGIN = 'http://app.test';
export const SIGN_IN_URL = `${FAKE_ORIGIN}/login`;

// The target a spec locates: fake specs name it in their only candidate (see fakeTarget).
const TARGET_ATTRIBUTE = 'data-target';

export function fakeTarget(name: string): TargetSpec {
  return { candidates: [{ strategy: 'attribute', name: TARGET_ATTRIBUTE, value: name }] };
}

function targetName(spec: TargetSpec): string {
  const [candidate] = spec.candidates;
  if (candidate?.strategy !== 'attribute' || candidate.name !== TARGET_ATTRIBUTE) throw new Error('fake gateway: not a fakeTarget spec');
  return candidate.value;
}

// What a fake page shows for a target: how many elements match it, and its value.
export type FakeElement = { count: number; value?: string };

export type FakePage = {
  url: string;
  // Visible texts, one observation node each.
  texts: string[];
  elements: Map<string, FakeElement>;
  // Shown in the next observation only, like a dialog the driver dismissed.
  dialog: Dialog | null;
};

// What an allowed step or recovery action does to the page. An outcome replaces the default one
// (done; a read returns the element's value); a fill has already set the value.
export type Effect = (page: FakePage, request: GatewayRequest, target: string | undefined) => GatewayOutcome | undefined;

export type FakeGatewayOptions = {
  readonly texts?: readonly string[];
  // Target names visible from the start, each matching one element.
  readonly visible?: readonly string[];
  // By step id.
  readonly effects?: Readonly<Record<string, Effect>>;
  readonly check?: (action: SurfaceAction) => PolicyDecision;
  readonly open?: OpenDecision;
  // Runs before every observation; may throw like a surface would.
  readonly onObserve?: (page: FakePage) => void;
};

export type FakeGateway = ActionGateway & {
  readonly page: FakePage;
  readonly performed: GatewayRequest[];
  readonly screenshots: (ScreenshotOptions | undefined)[];
};

// An effect that only changes the page; the action then completes as usual.
export function changes(change: (page: FakePage) => void): Effect {
  return (page) => {
    change(page);
    return undefined;
  };
}

export function show(page: FakePage, ...names: string[]): void {
  for (const name of names) page.elements.set(name, { count: 1 });
}

export function hide(page: FakePage, ...names: string[]): void {
  for (const name of names) page.elements.delete(name);
}

export function createFakeGateway(options: FakeGatewayOptions = {}): FakeGateway {
  const page: FakePage = { url: 'about:blank', texts: [...(options.texts ?? [])], elements: new Map(), dialog: null };
  show(page, ...(options.visible ?? []));
  const performed: GatewayRequest[] = [];
  const screenshots: (ScreenshotOptions | undefined)[] = [];
  const refs = new Map<string, string>();
  let observations = 0;

  function openDecision(): OpenDecision {
    return options.open ?? { decision: 'allow' };
  }

  return {
    page,
    performed,
    screenshots,
    checkOpen() {
      const decision = openDecision();
      return decision.decision === 'landed_outside_policy' ? { decision: 'allow' } : decision;
    },
    open(url) {
      page.url = url;
      return Promise.resolve(openDecision());
    },
    // Texts as context nodes, then each element that matches once as a node named by its target.
    observe() {
      options.onObserve?.(page);
      observations += 1;
      const elements = [...page.elements].flatMap(([name, element]) => {
        if (element.count !== 1) return [];
        const ref = `e${String(refs.size + 1)}`;
        refs.set(ref, name);
        return [{ ref, role: 'generic', name, ...(element.value === undefined ? {} : { value: element.value }), frame: null }];
      });
      const observation: Observation = {
        observationId: observations,
        url: page.url,
        frames: [{ name: null, url: page.url }],
        nodes: [...page.texts.map((text) => ({ role: 'text', name: text, frame: null })), ...elements],
        dialog: page.dialog,
      };
      page.dialog = null;
      return Promise.resolve(observation);
    },
    resolve(spec) {
      const name = targetName(spec);
      const count = page.elements.get(name)?.count ?? 0;
      if (count !== 1) return Promise.resolve({ status: 'unresolved', counts: [count] });
      const ref = `e${String(refs.size + 1)}`;
      refs.set(ref, name);
      return Promise.resolve({ status: 'resolved', ref, candidateIndex: 0, strategy: 'attribute', counts: [1] });
    },
    inspect: () => Promise.resolve({ attributes: {} }),
    check: (action) => Promise.resolve(options.check?.(action) ?? { decision: 'allow' }),
    perform(request) {
      performed.push(request);
      const { action } = request;
      const target = action.kind === 'navigate' ? undefined : refs.get(action.ref);
      const element = target === undefined ? undefined : page.elements.get(target);
      if (request.purpose !== 'checkpoint') {
        if (action.kind === 'fill' && element !== undefined) element.value = action.value;
        const scripted = options.effects?.[request.stepId]?.(page, request, target);
        if (scripted !== undefined) return Promise.resolve(scripted);
      }
      const value = action.kind === 'read' ? page.elements.get(target ?? '')?.value : undefined;
      return Promise.resolve(value === undefined ? { status: 'done', navigations: [] } : { status: 'done', value, navigations: [] });
    },
    screenshot(screenshotOptions) {
      screenshots.push(screenshotOptions);
      return Promise.resolve(new Uint8Array([137, 80, 78, 71]));
    },
  };
}

export type FakeClock = Clock & { readonly sleeps: number[] };

// Time moves only when someone sleeps.
export function createFakeClock(start = 0): FakeClock {
  let now = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep(ms) {
      sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    },
  };
}

export type FakeSession = SessionProvider & { established: number };

// The sign-in page is SIGN_IN_URL; `fail` makes every sign-in fail like the session provider would.
export function createFakeSession(fail?: SessionErrorCode): FakeSession {
  const session: FakeSession = {
    established: 0,
    establish() {
      session.established += 1;
      if (fail !== undefined) return Promise.reject(Object.assign(new Error(`sign-in failed: ${fail}`), { name: 'SessionError', code: fail }));
      return Promise.resolve([{ name: 'session', value: `fake-${String(session.established)}` }]);
    },
    isExpired: (observation) => observation.url === SIGN_IN_URL,
  };
  return session;
}

export type FakeEvidence = EvidenceRecorder & {
  readonly events: RunEvent[];
  readonly captures: { readonly stepId: string; readonly screenshot: boolean; readonly snapshot: boolean }[];
  readonly protected: SensitiveValue[];
  readonly results: (ExecutionResult | DiscoveryResult)[];
  readonly interventions: InterventionRequest[];
};

// Keeps everything in memory, unredacted, so tests can look at what was recorded.
export function createFakeEvidence(): FakeEvidence {
  const run = { runId: 'run-1', dir: '/evidence/run-1' };
  const evidence: FakeEvidence = {
    events: [],
    captures: [],
    protected: [],
    results: [],
    interventions: [],
    startRun: () => Promise.resolve(run),
    protect(values) {
      evidence.protected.push(...values);
    },
    redact: (value) => value,
    event(event) {
      evidence.events.push(event);
      return Promise.resolve();
    },
    capture(stepId, capture) {
      const seq = evidence.captures.length + 1;
      evidence.captures.push({ stepId, screenshot: capture.screenshot !== undefined, snapshot: capture.snapshot !== undefined });
      const paths: CapturePaths = {
        ...(capture.screenshot === undefined ? {} : { screenshot: `screenshots/${String(seq)}-${stepId}.png` }),
        ...(capture.snapshot === undefined ? {} : { snapshot: `snapshots/${String(seq)}-${stepId}.json` }),
      };
      return Promise.resolve(paths);
    },
    intervention(request) {
      evidence.interventions.push(request);
      return Promise.resolve();
    },
    artifact: () => Promise.resolve(),
    finish(result) {
      evidence.results.push(result);
      return Promise.resolve();
    },
  };
  return evidence;
}

// A store holding exactly `capability`.
export function createFakeStore(capability: Capability): ArtifactStore {
  const { id, version } = capability.capability;
  const path = `/capabilities/${id}/${version}.json`;
  const found: LoadResult = { ok: true, capability, status: 'approved', path };
  const missing = (at: string): LoadResult => ({ ok: false, code: 'not_found', path: at, issues: [`${at} not found`] });
  return {
    load: (loadId, loadVersion) => Promise.resolve(loadId === id && loadVersion === version ? found : missing(path)),
    loadLatest: (loadId, major) => Promise.resolve(loadId === id && version.startsWith(`${String(major)}.`) ? found : missing(`/capabilities/${loadId}`)),
    save: () => Promise.reject(new Error('fake store: save is not expected')),
  };
}

// What the human does once handed the session; the handoff then verifies it.
export type HumanWork = (request: HandoffRequest) => void;

export type FakeEscalationOptions = {
  readonly humanSurfaceAvailable: boolean;
  readonly human?: HumanWork;
  // Ends the handoff this way instead of letting the human work.
  readonly abort?: EscalationReason;
};

export type FakeEscalation = Escalation & { readonly requests: HandoffRequest[] };

// A handoff whose human is `human`: resumed when their work passes verify, else ended by the TTL.
export function createFakeEscalation(options: FakeEscalationOptions): FakeEscalation {
  const requests: HandoffRequest[] = [];
  const at = new Date(0).toISOString();
  return {
    requests,
    humanSurfaceAvailable: options.humanSurfaceAvailable,
    owner: () => 'automation',
    async handOff(request) {
      requests.push(request);
      const interventionId = `int-${String(requests.length)}`;
      const aborted = (cause: EscalationReason) => ({ status: 'aborted', interventionId, cause, at, actions: [] }) as const;
      if (!options.humanSurfaceAvailable) return aborted('no_operator_surface');
      if (options.abort !== undefined) return aborted(options.abort);
      options.human?.(request);
      const verification = await request.verify(new AbortController().signal);
      return verification.held ? { status: 'resumed', interventionId, by: 'test-operator', at, actions: [] } : aborted('ttl_expired');
    },
  };
}
