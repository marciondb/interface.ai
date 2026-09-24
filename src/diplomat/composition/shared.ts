import { join } from 'node:path';
import { fromPolicyFile } from '../../adapters/policy-file';
import { createEscalationController, type Escalation } from '../../controllers/escalation';
import { systemClock, type Clock } from '../../infrastructure/clock';
import { REPO_ROOT, type Config } from '../../infrastructure/config';
import { errorMessage } from '../../infrastructure/errors';
import { readJsonFile } from '../../infrastructure/json-file';
import { urlViolation } from '../../logic/policy';
import type { Policy } from '../../models/policy';
import { createCliBroker } from '../escalation/cli-broker';
import type { EscalationBroker } from '../escalation/port';
import { createFsRecorder } from '../evidence/fs-recorder';
import type { EvidenceRecorder } from '../evidence/port';
import { createActionGateway } from '../gateway/action-gateway';
import type { ActionGateway } from '../gateway/port';
import { createFixtureSessionProvider } from '../session/fixture-login';
import type { SessionProvider } from '../session/port';
import { createFsArtifactStore } from '../store/fs-store';
import type { ArtifactStore } from '../store/port';
import { createPlaywrightDriver } from '../surface/playwright-driver';
import type { HumanSurface, SurfaceDriver } from '../surface/port';

export const POLICY_PATH = join(REPO_ROOT, 'policy.json');
export const CAPABILITIES_DIR = join(REPO_ROOT, 'capabilities');

export type PolicyResult = { ok: true; policy: Policy } | { ok: false; issues: string[] };

export async function loadPolicy(path = POLICY_PATH): Promise<PolicyResult> {
  let raw: unknown;
  try {
    raw = await readJsonFile(path);
  } catch (error) {
    return { ok: false, issues: [`${path}: ${errorMessage(error)}`] };
  }
  const policy = fromPolicyFile(raw);
  return policy.ok ? policy : { ok: false, issues: policy.issues.map((issue) => `${path}: ${issue}`) };
}

// The policy, refusing a target outside its allowlist before anything is launched.
export async function loadPolicyFor(targetUrl: string, path = POLICY_PATH): Promise<PolicyResult> {
  const loaded = await loadPolicy(path);
  if (!loaded.ok) return loaded;
  const outside = urlViolation(targetUrl, loaded.policy);
  return outside === undefined ? loaded : { ok: false, issues: [`--target is outside the policy allowlist: ${outside}`] };
}

export type StackDriver = SurfaceDriver & HumanSurface;

export type StackSettings = {
  // A visible browser window, which is also the operator's surface for a handoff (ADR-012).
  readonly headed: boolean;
  // Artifact store root (default: capabilities/ of the repository).
  readonly capabilitiesDir?: string;
};

// Seams for the harnesses and the demo; the CLIs pass none. Each wrap receives the real
// component and returns what the controller gets.
export type StackOverrides = {
  readonly driver?: StackDriver;
  readonly broker?: EscalationBroker;
  // Default: settings.headed.
  readonly humanSurfaceAvailable?: boolean;
  readonly clock?: Clock;
  readonly wrapDriver?: (driver: SurfaceDriver) => SurfaceDriver;
  readonly wrapGateway?: (gateway: ActionGateway) => ActionGateway;
  readonly wrapSession?: (session: SessionProvider) => SessionProvider;
  readonly wrapEvidence?: (evidence: EvidenceRecorder) => EvidenceRecorder;
  readonly wrapEscalation?: (escalation: Escalation) => Escalation;
  readonly wrapStore?: (store: ArtifactStore) => ArtifactStore;
};

export type CommonDeps = {
  readonly store: ArtifactStore;
  readonly session: SessionProvider;
  readonly gateway: ActionGateway;
  readonly evidence: EvidenceRecorder;
  readonly escalation: Escalation;
  readonly clock: Clock;
};

export type CommonStack = {
  readonly deps: CommonDeps;
  close(): Promise<void>;
};

const identity = <T>(value: T): T => value;

// Everything both paths share: one browser, the policed gateway, the session, the evidence
// recorder masking `secrets`, the escalation controller and the artifact store.
export function buildCommonStack(
  config: Config,
  policy: Policy,
  // includeDrafts: whether loadLatest also resolves to drafts (ADR-007).
  settings: StackSettings & { readonly includeDrafts?: boolean },
  secrets: readonly string[],
  overrides: StackOverrides,
): CommonStack {
  const driver = overrides.driver ?? createPlaywrightDriver({ headless: !settings.headed });
  const clock = overrides.clock ?? systemClock;
  const evidence = (overrides.wrapEvidence ?? identity)(createFsRecorder({ root: config.evidenceDir, secrets: [...secrets] }));
  // Prompts go to stderr: stdout carries only the result.
  const broker = overrides.broker ?? createCliBroker({ input: process.stdin, output: process.stderr, evidenceRoot: config.evidenceDir });
  const controller = createEscalationController(
    { surface: driver, broker, evidence, clock },
    { ttlMs: config.handoffTtlMs, humanSurfaceAvailable: overrides.humanSurfaceAvailable ?? settings.headed, operatorId: config.operatorId },
  );
  const gateway = (overrides.wrapGateway ?? identity)(
    createActionGateway({ driver: (overrides.wrapDriver ?? identity)(driver), policy, controlOwner: controller.owner }),
  );
  const session = (overrides.wrapSession ?? identity)(
    createFixtureSessionProvider({ username: config.targetUsername, password: config.targetPassword }),
  );
  const store = (overrides.wrapStore ?? identity)(
    createFsArtifactStore(settings.capabilitiesDir ?? CAPABILITIES_DIR, { includeDrafts: settings.includeDrafts ?? false }),
  );
  return {
    deps: { store, session, gateway, evidence, escalation: (overrides.wrapEscalation ?? identity)(controller), clock },
    async close() {
      broker.close();
      await driver.close();
    },
  };
}
