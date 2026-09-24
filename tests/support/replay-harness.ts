import { copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { armBefore, fixturePolicy, type ArmPlan, type FixtureHandle } from '../../scripts/lib/fixture';
import { FIXTURE_PASSWORD, FIXTURE_USERNAME } from '../../scripts/lib/fixture-data';
import type { HumanActor } from '../../scripts/lib/human-actor';
import { buildReplayStack } from '../../src/diplomat/composition/replay';
import { CAPABILITIES_DIR, loadPolicy } from '../../src/diplomat/composition/shared';
import { createCliBroker } from '../../src/diplomat/escalation/cli-broker';
import type { EscalationBroker } from '../../src/diplomat/escalation/port';
import type { ActionGateway } from '../../src/diplomat/gateway/port';
import { createPlaywrightDriver } from '../../src/diplomat/surface/playwright-driver';
import { loadConfig, type Config } from '../../src/infrastructure/config';
import type { SurfaceActionKind } from '../../src/models/action';
import type { ExecutionResult } from '../../src/models/execution-result';
import type { Policy } from '../../src/models/policy';
import type { ActionPurpose } from '../../src/models/run-event';

export { armBefore, type ArmPlan } from '../../scripts/lib/fixture';

export const PASSWORD = FIXTURE_PASSWORD;
export const STEP_TIMEOUT_MS = 2_000;
export const OPERATOR_ID = 'test-operator';

// The configuration the harnesses run with, whatever the environment says.
export function harnessConfig(evidenceDir: string, handoffTtlMs = 30_000): Config {
  return { ...loadConfig({}), targetUsername: FIXTURE_USERNAME, targetPassword: FIXTURE_PASSWORD, evidenceDir, handoffTtlMs, operatorId: OPERATOR_ID };
}

// A broker nobody answers: without an operator there is no operator surface either.
export function unattendedBroker(): EscalationBroker {
  return createCliBroker({ input: new PassThrough(), output: new PassThrough() });
}

// The committed policy.json pointed at the fixture, adjusted by the test.
export async function harnessPolicy(fixture: FixtureHandle, adjust?: (policy: Policy) => Policy): Promise<Policy> {
  const loaded = await loadPolicy();
  if (!loaded.ok) throw new Error(loaded.issues.join('; '));
  const policy = fixturePolicy(loaded.policy, fixture);
  return adjust === undefined ? policy : adjust(policy);
}

// An action that reached the surface driver.
export type DriverCall = {
  readonly stepId: string;
  readonly purpose: ActionPurpose;
  readonly verb: SurfaceActionKind;
};

export type HarnessRun = {
  readonly result: ExecutionResult;
  readonly evidenceRoot: string;
  readonly driverCalls: readonly DriverCall[];
  // Sign-ins through the session provider (the first one included).
  readonly sessionsEstablished: number;
};

export type HarnessOptions = {
  readonly arm?: ArmPlan;
  readonly capability?: string;
  readonly major?: number;
  readonly stepTimeoutMs?: number;
  // Artifact store root (default: the committed capabilities/).
  readonly capabilitiesDir?: string;
  // Also replays drafts (the CLI's --allow-draft).
  readonly allowDraft?: boolean;
  // Adjusts the committed policy.json (its origin already points at the fixture).
  readonly policy?: (policy: Policy) => Policy;
  // The operator of a handoff; without one there is no operator surface.
  readonly operator?: HumanActor;
  readonly handoffTtlMs?: number;
  // Evidence root (default: a fresh temp dir).
  readonly evidenceRoot?: string;
};

// A store holding only the hand-written read-account-balance@1.0.0, the reference the replay
// tests are written against (the committed store also has discovered versions of it).
export async function referenceCapabilities(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'reference-capabilities-'));
  await mkdir(join(dir, 'member.read-account-balance'));
  await copyFile(join(CAPABILITIES_DIR, 'member.read-account-balance/1.0.0.json'), join(dir, 'member.read-account-balance/1.0.0.json'));
  return dir;
}

// The replay stack the CLI ships, against a running fixture, with spies on the driver, the
// gateway and the session, and evidence in a fresh temp dir.
export async function runReplay(fixture: FixtureHandle, inputs: Record<string, string>, options: HarnessOptions = {}): Promise<HarnessRun> {
  const policy = await harnessPolicy(fixture, options.policy);
  const evidenceRoot = options.evidenceRoot ?? (await mkdtemp(join(tmpdir(), 'replay-evidence-')));
  const driver = createPlaywrightDriver({ exposePageForTests: true });
  const driverCalls: DriverCall[] = [];
  let current: Omit<DriverCall, 'verb'> = { stepId: '', purpose: 'step' };
  let sessionsEstablished = 0;

  const stack = buildReplayStack(
    harnessConfig(evidenceRoot, options.handoffTtlMs),
    policy,
    {
      headed: false,
      capabilitiesDir: options.capabilitiesDir,
      allowDraft: options.allowDraft,
      stepTimeoutMs: options.stepTimeoutMs ?? STEP_TIMEOUT_MS,
    },
    {
      driver,
      broker: options.operator?.broker ?? unattendedBroker(),
      humanSurfaceAvailable: options.operator !== undefined,
      wrapDriver: (surface) => ({
        ...surface,
        perform(action, performOptions) {
          driverCalls.push({ ...current, verb: action.kind });
          return surface.perform(action, performOptions);
        },
      }),
      wrapGateway: (policed) => {
        const spied: ActionGateway = {
          ...policed,
          perform(request) {
            current = { stepId: request.stepId, purpose: request.purpose };
            return policed.perform(request);
          },
        };
        return options.arm === undefined ? spied : armBefore(spied, fixture, options.arm);
      },
      wrapSession: (provider) => ({
        ...provider,
        establish(targetUrl) {
          sessionsEstablished += 1;
          return provider.establish(targetUrl);
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
    const result = await stack.run({
      capabilityId: options.capability ?? 'member.read-account-balance',
      major: options.major ?? 1,
      inputs,
      targetUrl: `${fixture.baseUrl}/`,
    });
    return { result, evidenceRoot, driverCalls, sessionsEstablished };
  } finally {
    await stack.close();
  }
}
