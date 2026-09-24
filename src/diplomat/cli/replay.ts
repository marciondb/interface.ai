import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fromPolicyFile } from '../../adapters/policy-file';
import { toReplayRequest } from '../../adapters/replay-args';
import { replay } from '../../controllers/replay';
import { systemClock } from '../../infrastructure/clock';
import { loadConfig } from '../../infrastructure/config';
import { readJsonFile } from '../../infrastructure/json-file';
import { urlViolation } from '../../logic/policy';
import type { ExecutionResult } from '../../models/execution-result';
import { createFsRecorder } from '../evidence/fs-recorder';
import { createActionGateway } from '../gateway/action-gateway';
import { createFixtureSessionProvider } from '../session/fixture-login';
import { createFsArtifactStore } from '../store/fs-store';
import { createPlaywrightDriver } from '../surface/playwright-driver';

const USAGE = 'usage: npm run replay -- --capability <id>@<major> [--input name=value]... [--target <url>] [--headed]';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const USAGE_ERROR = 1;

function exitCode(result: ExecutionResult): number {
  switch (result.status) {
    case 'succeeded':
      return 0;
    case 'business_outcome':
      return 2;
    case 'failed':
      return 3;
    case 'escalated':
      return 4;
    default: {
      const unhandled: never = result;
      return unhandled;
    }
  }
}

function usageError(...lines: string[]): number {
  for (const line of [...lines, USAGE]) process.stderr.write(`${line}\n`);
  return USAGE_ERROR;
}

async function main(argv: string[]): Promise<number> {
  let values: unknown;
  try {
    values = parseArgs({
      args: argv,
      options: {
        capability: { type: 'string' },
        input: { type: 'string', multiple: true },
        target: { type: 'string' },
        headed: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error) {
    return usageError((error as Error).message);
  }
  const args = toReplayRequest(values);
  if (!args.ok) return usageError(...args.issues);
  const { request, headed } = args;

  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    return usageError(`config: ${(error as Error).message}`);
  }

  let policyFile: unknown;
  try {
    policyFile = await readJsonFile(join(ROOT, 'policy.json'));
  } catch (error) {
    return usageError(`policy.json: ${(error as Error).message}`);
  }
  const policy = fromPolicyFile(policyFile);
  if (!policy.ok) return usageError(...policy.issues.map((issue) => `policy.json: ${issue}`));
  const outside = urlViolation(request.targetUrl, policy.policy);
  if (outside !== undefined) return usageError(`--target is outside the policy allowlist: ${outside}`);

  const driver = createPlaywrightDriver({ headless: !headed });
  try {
    const result = await replay(
      {
        store: createFsArtifactStore(join(ROOT, 'capabilities')),
        session: createFixtureSessionProvider({ username: config.targetUsername, password: config.targetPassword }),
        gateway: createActionGateway({ driver, policy: policy.policy }),
        evidence: createFsRecorder({ root: config.evidenceDir, secrets: [config.targetPassword] }),
        clock: systemClock,
      },
      request,
      { stepTimeoutMs: config.replayStepTimeoutMs },
    );
    // The caller's channel: outputs are unmasked here, unlike in the evidence.
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.stderr.write(`evidence: ${join(config.evidenceDir, result.runId)}\n`);
    return exitCode(result);
  } finally {
    await driver.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`replay: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = USAGE_ERROR;
  },
);
