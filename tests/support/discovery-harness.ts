import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FixtureHandle } from '../../scripts/lib/fixture';
import type { HumanActor } from '../../scripts/lib/human-actor';
import type { DiscoveryOptions } from '../../src/controllers/discovery';
import type { HandoffRequest } from '../../src/controllers/escalation';
import { buildDiscoveryStack } from '../../src/diplomat/composition/discovery';
import type { Reasoner } from '../../src/diplomat/reasoner/port';
import { loadCatalog, loadRequest } from '../../src/diplomat/store/discovery-inputs';
import { createPlaywrightDriver } from '../../src/diplomat/surface/playwright-driver';
import type { Clock } from '../../src/infrastructure/clock';
import { REPO_ROOT } from '../../src/infrastructure/config';
import type { SurfaceAction } from '../../src/models/action';
import type { CapabilityRequest } from '../../src/models/capability-request';
import type { DiscoveryResult } from '../../src/models/discovery';
import type { Policy } from '../../src/models/policy';
import { harnessConfig, harnessPolicy, PASSWORD, unattendedBroker } from './replay-harness';

export const READ_REQUEST = join(REPO_ROOT, 'discovery/requests/member.read-account-balance.json');
export const SUB_ACCOUNT_REQUEST = join(REPO_ROOT, 'discovery/requests/member.open-sub-account.json');

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

// The discovery stack the CLI ships, against a running fixture with the given reasoner;
// evidence and the artifact go to temp dirs.
export async function runDiscovery(fixture: FixtureHandle, reasoner: Reasoner, options: DiscoveryHarnessOptions = {}): Promise<DiscoveryHarnessRun> {
  const loaded = await loadRequest(options.requestPath ?? READ_REQUEST);
  if (!loaded.ok) throw new Error(loaded.issues.join('; '));
  const request = options.request === undefined ? loaded.request : options.request(loaded.request);
  const catalog = await loadCatalog(join(REPO_ROOT, 'discovery/catalogs'), request.capability.app.product);
  if (!catalog.ok) throw new Error(catalog.issues.join('; '));
  const policy = await harnessPolicy(fixture, options.policy);
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'discovery-evidence-'));
  const capabilitiesDir = options.capabilitiesDir ?? (await mkdtemp(join(tmpdir(), 'discovery-capabilities-')));
  const driver = createPlaywrightDriver({ exposePageForTests: true });
  const driverCalls: SurfaceAction[] = [];
  const escalations: HandoffRequest[] = [];

  const stack = buildDiscoveryStack(
    harnessConfig(evidenceRoot, options.handoffTtlMs),
    policy,
    { headed: false, capabilitiesDir, reasoner, secrets: [PASSWORD], stepTimeoutMs: options.stepTimeoutMs ?? 2_000, limits: options.limits },
    {
      driver,
      broker: options.operator?.broker ?? unattendedBroker(),
      humanSurfaceAvailable: options.operator !== undefined,
      clock: options.clock,
      wrapDriver: (surface) => ({
        ...surface,
        perform(action, performOptions) {
          driverCalls.push(action);
          return surface.perform(action, performOptions);
        },
      }),
      wrapEscalation: (escalation) => ({
        ...escalation,
        handOff(handoff) {
          escalations.push(handoff);
          return escalation.handOff(handoff);
        },
      }),
    },
  );
  options.operator?.attach({
    // The page exists once the run opens the target.
    get page() {
      return driver.page();
    },
    gateway: stack.gateway,
  });

  try {
    const result = await stack.run({ request, catalog: catalog.catalog, targetUrl: `${fixture.baseUrl}/` });
    return { result, evidenceRoot, capabilitiesDir, driverCalls, escalations };
  } finally {
    await stack.close();
  }
}
