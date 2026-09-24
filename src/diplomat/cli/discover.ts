import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { toDiscoverArgs, type ReasonerChoice } from '../../adapters/discover-args';
import { fromPolicyFile } from '../../adapters/policy-file';
import { discover } from '../../controllers/discovery';
import { systemClock } from '../../infrastructure/clock';
import { loadConfig, type Config } from '../../infrastructure/config';
import { readJsonFile } from '../../infrastructure/json-file';
import { checkRequest } from '../../logic/capability-request';
import { urlViolation } from '../../logic/policy';
import type { DiscoveryResult } from '../../models/discovery';
import { noOperatorBroker } from '../escalation/no-operator';
import { createFsRecorder } from '../evidence/fs-recorder';
import type { EvidenceRecorder } from '../evidence/port';
import { createActionGateway } from '../gateway/action-gateway';
import { createOllamaReasoner } from '../reasoner/ollama';
import { createOpenAiCompatibleReasoner } from '../reasoner/openai-compatible';
import type { Reasoner } from '../reasoner/port';
import { createFixtureSessionProvider } from '../session/fixture-login';
import { loadCatalog, loadRequest } from '../store/discovery-inputs';
import { createFsArtifactStore } from '../store/fs-store';
import { createPlaywrightDriver } from '../surface/playwright-driver';

const USAGE = 'usage: npm run discover -- --request <file> [--reasoner local|hosted] [--target <url>] [--headed]';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const USAGE_ERROR = 1;
const STEP_TIMEOUT_MS = 5_000;

function exitCode(result: DiscoveryResult): number {
  switch (result.status) {
    case 'succeeded':
      return 0;
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

function createReasoner(choice: ReasonerChoice, config: Config): Reasoner {
  switch (choice) {
    case 'local':
      return createOllamaReasoner({ baseUrl: config.ollamaBaseUrl, model: config.reasonerModel });
    case 'hosted':
      return createOpenAiCompatibleReasoner(config.hosted);
    default: {
      const unhandled: never = choice;
      return unhandled;
    }
  }
}

// Echoes each decision to the operator's terminal while the run is in progress.
function narrated(recorder: EvidenceRecorder): EvidenceRecorder {
  return {
    ...recorder,
    event(event) {
      if (event.type === 'decision') {
        const target = event.target === null ? '' : ` ${event.target}`;
        const argument = event.argument === null ? '' : ` ${JSON.stringify(event.argument)}`;
        process.stderr.write(`${event.stepId} ${event.verb}${target}${argument} (${String(event.latencyMs)} ms): ${event.rationale}\n`);
      }
      return recorder.event(event);
    },
  };
}

async function main(argv: string[]): Promise<number> {
  let values: unknown;
  try {
    values = parseArgs({
      args: argv,
      options: {
        request: { type: 'string' },
        reasoner: { type: 'string' },
        target: { type: 'string' },
        headed: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error) {
    return usageError((error as Error).message);
  }
  const parsed = toDiscoverArgs(values);
  if (!parsed.ok) return usageError(...parsed.issues);
  const { args } = parsed;

  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    return usageError(`config: ${(error as Error).message}`);
  }

  const request = await loadRequest(args.requestPath);
  if (!request.ok) return usageError(...request.issues);
  const catalog = await loadCatalog(join(ROOT, 'discovery', 'catalogs'), request.request.capability.app.product);
  if (!catalog.ok) return usageError(...catalog.issues);
  const problems = checkRequest(request.request, catalog.catalog);
  if (problems.length > 0) return usageError(...problems.map((problem) => `${args.requestPath}: ${problem}`));

  let policyFile: unknown;
  try {
    policyFile = await readJsonFile(join(ROOT, 'policy.json'));
  } catch (error) {
    return usageError(`policy.json: ${(error as Error).message}`);
  }
  const policy = fromPolicyFile(policyFile);
  if (!policy.ok) return usageError(...policy.issues.map((issue) => `policy.json: ${issue}`));
  const outside = urlViolation(args.targetUrl, policy.policy);
  if (outside !== undefined) return usageError(`--target is outside the policy allowlist: ${outside}`);

  let reasoner: Reasoner;
  try {
    reasoner = createReasoner(args.reasoner, config);
  } catch (error) {
    return usageError(`--reasoner ${args.reasoner}: ${(error as Error).message}`);
  }

  const driver = createPlaywrightDriver({ headless: !args.headed });
  try {
    const result = await discover(
      {
        store: createFsArtifactStore(join(ROOT, 'capabilities')),
        session: createFixtureSessionProvider({ username: config.targetUsername, password: config.targetPassword }),
        gateway: createActionGateway({ driver, policy: policy.policy }),
        reasoner,
        evidence: narrated(createFsRecorder({ root: config.evidenceDir, secrets: [config.targetPassword] })),
        escalation: noOperatorBroker,
        clock: systemClock,
      },
      { request: request.request, catalog: catalog.catalog, targetUrl: args.targetUrl, secrets: [config.targetPassword] },
      { stepTimeoutMs: STEP_TIMEOUT_MS },
    );
    // The caller's channel: outputs are unmasked here, unlike in the evidence.
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === 'succeeded') {
      process.stderr.write(`artifact: ${join('capabilities', result.capability.id, `${result.capability.version}.json`)}\n`);
    }
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
    process.stderr.write(`discover: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = USAGE_ERROR;
  },
);
