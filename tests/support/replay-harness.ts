import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromPolicyFile } from '../../src/adapters/policy-file';
import { replay } from '../../src/controllers/replay';
import { createFsRecorder } from '../../src/diplomat/evidence/fs-recorder';
import { createActionGateway } from '../../src/diplomat/gateway/action-gateway';
import type { ActionGateway } from '../../src/diplomat/gateway/port';
import { createFixtureSessionProvider } from '../../src/diplomat/session/fixture-login';
import { createFsArtifactStore } from '../../src/diplomat/store/fs-store';
import { createPlaywrightDriver } from '../../src/diplomat/surface/playwright-driver';
import { systemClock } from '../../src/infrastructure/clock';
import { readJsonFile } from '../../src/infrastructure/json-file';
import { redactSecrets } from '../../src/logic/redaction';
import type { ExecutionResult } from '../../src/models/execution-result';
import type { FaultKind, FixtureHandle } from './fixture';

export const PASSWORD = 'training';
export const STEP_TIMEOUT_MS = 2_000;

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

export type HarnessRun = {
  readonly result: ExecutionResult;
  readonly evidenceRoot: string;
};

export type HarnessOptions = {
  readonly arm?: ArmPlan;
  readonly capability?: string;
  readonly major?: number;
  readonly stepTimeoutMs?: number;
};

// The real replay stack against a running fixture, with evidence in a fresh temp dir.
export async function runReplay(
  fixture: FixtureHandle,
  inputs: Record<string, string>,
  options: HarnessOptions = {},
): Promise<HarnessRun> {
  const policyFile = fromPolicyFile(await readJsonFile(join(ROOT, 'policy.json')));
  if (!policyFile.ok) throw new Error(policyFile.issues.join('; '));
  const policy = { ...policyFile.policy, allowedOrigins: [new URL(fixture.baseUrl).origin] };
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'replay-evidence-'));
  const driver = createPlaywrightDriver();
  const gateway = createActionGateway({ driver, policy });
  try {
    const result = await replay(
      {
        store: createFsArtifactStore(join(ROOT, 'capabilities')),
        session: createFixtureSessionProvider({ username: 'operator', password: PASSWORD }),
        gateway: options.arm === undefined ? gateway : armBefore(gateway, fixture, options.arm),
        evidence: createFsRecorder({ root: evidenceRoot, redact: (record) => redactSecrets(record, [PASSWORD]) }),
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
    return { result, evidenceRoot };
  } finally {
    await driver.close();
  }
}
