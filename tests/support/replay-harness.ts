import { copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { fromPolicyFile } from '../../src/adapters/policy-file';
import { createEscalationController } from '../../src/controllers/escalation';
import { replay } from '../../src/controllers/replay';
import { createCliBroker } from '../../src/diplomat/escalation/cli-broker';
import { createFsRecorder } from '../../src/diplomat/evidence/fs-recorder';
import { createActionGateway } from '../../src/diplomat/gateway/action-gateway';
import type { ActionGateway } from '../../src/diplomat/gateway/port';
import { createFixtureSessionProvider } from '../../src/diplomat/session/fixture-login';
import { createFsArtifactStore } from '../../src/diplomat/store/fs-store';
import { createPlaywrightDriver } from '../../src/diplomat/surface/playwright-driver';
import type { SurfaceDriver } from '../../src/diplomat/surface/port';
import { systemClock } from '../../src/infrastructure/clock';
import { readJsonFile } from '../../src/infrastructure/json-file';
import type { Verb } from '../../src/models/action';
import type { ExecutionResult } from '../../src/models/execution-result';
import type { Policy } from '../../src/models/policy';
import type { ActionPurpose } from '../../src/models/run-event';
import type { FaultKind, FixtureHandle } from './fixture';
import type { HumanActor } from './human-actor';

export const PASSWORD = 'training';
export const STEP_TIMEOUT_MS = 2_000;
export const OPERATOR_ID = 'test-operator';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export type ArmPlan = {
  readonly stepId: string;
  readonly kind: FaultKind;
  // How many times the step's action gets the fault armed right before it (default 1).
  readonly times?: number;
};

// Faults are one-shot and fire on the next request, sign-in included, so they are armed
// right before the step's own action rather than before the run.
export function armBefore(gateway: ActionGateway, fixture: FixtureHandle, plan: ArmPlan): ActionGateway {
  let remaining = plan.times ?? 1;
  return {
    ...gateway,
    async perform(request) {
      if (request.purpose === 'step' && request.stepId === plan.stepId && remaining > 0) {
        remaining -= 1;
        await fixture.armFault(plan.kind);
      }
      return gateway.perform(request);
    },
  };
}

// An action that reached the surface driver.
export type DriverCall = {
  readonly stepId: string;
  readonly purpose: ActionPurpose;
  readonly verb: Verb;
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
  await copyFile(join(ROOT, 'capabilities/member.read-account-balance/1.0.0.json'), join(dir, 'member.read-account-balance/1.0.0.json'));
  return dir;
}

// The real replay stack against a running fixture, with evidence in a fresh temp dir.
export async function runReplay(
  fixture: FixtureHandle,
  inputs: Record<string, string>,
  options: HarnessOptions = {},
): Promise<HarnessRun> {
  const policyFile = fromPolicyFile(await readJsonFile(join(ROOT, 'policy.json')));
  if (!policyFile.ok) throw new Error(policyFile.issues.join('; '));
  const basePolicy = { ...policyFile.policy, allowedOrigins: [new URL(fixture.baseUrl).origin] };
  const policy = options.policy === undefined ? basePolicy : options.policy(basePolicy);
  const evidenceRoot = options.evidenceRoot ?? (await mkdtemp(join(tmpdir(), 'replay-evidence-')));

  const driver = createPlaywrightDriver();
  const evidence = createFsRecorder({ root: evidenceRoot, secrets: [PASSWORD] });
  const broker = options.operator?.broker ?? createCliBroker({ input: new PassThrough(), output: new PassThrough() });
  const escalation = createEscalationController(
    { surface: driver, broker, evidence, clock: systemClock },
    { ttlMs: options.handoffTtlMs ?? 30_000, humanSurfaceAvailable: options.operator !== undefined, operatorId: OPERATOR_ID },
  );
  const driverCalls: DriverCall[] = [];
  let current: Omit<DriverCall, 'verb'> = { stepId: '', purpose: 'step' };
  const spiedDriver: SurfaceDriver = {
    ...driver,
    perform(action, performOptions) {
      driverCalls.push({ ...current, verb: action.verb });
      return driver.perform(action, performOptions);
    },
  };
  const policed = createActionGateway({ driver: spiedDriver, policy, controlOwner: escalation.owner });
  const gateway: ActionGateway = {
    ...policed,
    perform(request) {
      current = { stepId: request.stepId, purpose: request.purpose };
      return policed.perform(request);
    },
  };
  options.operator?.attach({
    // The page exists once the run opens the target.
    get page() {
      return driver.page();
    },
    gateway,
  });
  const provider = createFixtureSessionProvider({ username: 'operator', password: PASSWORD });
  let sessionsEstablished = 0;

  try {
    const result = await replay(
      {
        store: createFsArtifactStore(options.capabilitiesDir ?? join(ROOT, 'capabilities')),
        session: {
          ...provider,
          establish(targetUrl) {
            sessionsEstablished += 1;
            return provider.establish(targetUrl);
          },
        },
        gateway: options.arm === undefined ? gateway : armBefore(gateway, fixture, options.arm),
        evidence,
        escalation,
        clock: systemClock,
      },
      {
        capabilityId: options.capability ?? 'member.read-account-balance',
        major: options.major ?? 1,
        inputs,
        targetUrl: `${fixture.baseUrl}/`,
      },
      { stepTimeoutMs: options.stepTimeoutMs ?? STEP_TIMEOUT_MS },
    );
    return { result, evidenceRoot, driverCalls, sessionsEstablished };
  } finally {
    broker.close();
    await driver.close();
  }
}
