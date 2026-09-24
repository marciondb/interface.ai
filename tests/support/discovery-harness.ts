import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { fromPolicyFile } from '../../src/adapters/policy-file';
import { discover, type DiscoveryOptions } from '../../src/controllers/discovery';
import { createEscalationController, type HandoffRequest } from '../../src/controllers/escalation';
import { createCliBroker } from '../../src/diplomat/escalation/cli-broker';
import { createFsRecorder } from '../../src/diplomat/evidence/fs-recorder';
import { createActionGateway } from '../../src/diplomat/gateway/action-gateway';
import type { Reasoner } from '../../src/diplomat/reasoner/port';
import { createFixtureSessionProvider } from '../../src/diplomat/session/fixture-login';
import { loadCatalog, loadRequest } from '../../src/diplomat/store/discovery-inputs';
import { createFsArtifactStore } from '../../src/diplomat/store/fs-store';
import { createPlaywrightDriver } from '../../src/diplomat/surface/playwright-driver';
import type { SurfaceDriver } from '../../src/diplomat/surface/port';
import { systemClock, type Clock } from '../../src/infrastructure/clock';
import { readJsonFile } from '../../src/infrastructure/json-file';
import type { SurfaceAction } from '../../src/models/action';
import type { CapabilityRequest } from '../../src/models/capability-request';
import type { DiscoveryResult } from '../../src/models/discovery';
import type { Policy } from '../../src/models/policy';
import type { FixtureHandle } from './fixture';
import type { HumanActor } from './human-actor';
import { OPERATOR_ID, PASSWORD } from './replay-harness';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const READ_REQUEST = join(ROOT, 'discovery/requests/member.read-account-balance.json');
export const SUB_ACCOUNT_REQUEST = join(ROOT, 'discovery/requests/member.open-sub-account.json');

export type DiscoveryHarnessOptions = Partial<DiscoveryOptions> & {
  // Request file (default: the read-balance request).
  readonly requestPath?: string;
  readonly request?: (request: CapabilityRequest) => CapabilityRequest;
  readonly policy?: (policy: Policy) => Policy;
  // The operator of a handoff; without one there is no operator surface.
  readonly operator?: HumanActor;
  readonly handoffTtlMs?: number;
  readonly clock?: Clock;
  // Artifact store root (default: a fresh temp dir).
  readonly capabilitiesDir?: string;
};

export type DiscoveryHarnessRun = {
  readonly result: DiscoveryResult;
  readonly evidenceRoot: string;
  readonly capabilitiesDir: string;
  // Actions that reached the surface driver.
  readonly driverCalls: readonly SurfaceAction[];
  readonly escalations: readonly HandoffRequest[];
};

// The real discovery stack against a running fixture with the given reasoner; evidence and
// the artifact go to temp dirs.
export async function runDiscovery(fixture: FixtureHandle, reasoner: Reasoner, options: DiscoveryHarnessOptions = {}): Promise<DiscoveryHarnessRun> {
  const loaded = await loadRequest(options.requestPath ?? READ_REQUEST);
  if (!loaded.ok) throw new Error(loaded.issues.join('; '));
  const request = options.request === undefined ? loaded.request : options.request(loaded.request);
  const catalog = await loadCatalog(join(ROOT, 'discovery/catalogs'), request.capability.app.product);
  if (!catalog.ok) throw new Error(catalog.issues.join('; '));
  const policyFile = fromPolicyFile(await readJsonFile(join(ROOT, 'policy.json')));
  if (!policyFile.ok) throw new Error(policyFile.issues.join('; '));
  const basePolicy = { ...policyFile.policy, allowedOrigins: [new URL(fixture.baseUrl).origin] };
  const policy = options.policy === undefined ? basePolicy : options.policy(basePolicy);
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'discovery-evidence-'));
  const capabilitiesDir = options.capabilitiesDir ?? (await mkdtemp(join(tmpdir(), 'discovery-capabilities-')));

  const driver = createPlaywrightDriver();
  const clock = options.clock ?? systemClock;
  const evidence = createFsRecorder({ root: evidenceRoot, secrets: [PASSWORD] });
  const broker = options.operator?.broker ?? createCliBroker({ input: new PassThrough(), output: new PassThrough() });
  const escalation = createEscalationController(
    { surface: driver, broker, evidence, clock },
    { ttlMs: options.handoffTtlMs ?? 30_000, humanSurfaceAvailable: options.operator !== undefined, operatorId: OPERATOR_ID },
  );
  const driverCalls: SurfaceAction[] = [];
  const spiedDriver: SurfaceDriver = {
    ...driver,
    perform(action, performOptions) {
      driverCalls.push(action);
      return driver.perform(action, performOptions);
    },
  };
  const escalations: HandoffRequest[] = [];
  const gateway = createActionGateway({ driver: spiedDriver, policy, controlOwner: escalation.owner });
  options.operator?.attach({
    // The page exists once the run opens the target.
    get page() {
      return driver.page();
    },
    gateway,
  });

  try {
    const result = await discover(
      {
        store: createFsArtifactStore(capabilitiesDir),
        session: createFixtureSessionProvider({ username: 'operator', password: PASSWORD }),
        gateway,
        reasoner,
        evidence,
        escalation: {
          ...escalation,
          handOff(request) {
            escalations.push(request);
            return escalation.handOff(request);
          },
        },
        clock,
      },
      { request, catalog: catalog.catalog, targetUrl: `${fixture.baseUrl}/`, secrets: [PASSWORD] },
      { stepTimeoutMs: options.stepTimeoutMs ?? 2_000, ...(options.limits === undefined ? {} : { limits: options.limits }) },
    );
    return { result, evidenceRoot, capabilitiesDir, driverCalls, escalations };
  } finally {
    broker.close();
    await driver.close();
  }
}
