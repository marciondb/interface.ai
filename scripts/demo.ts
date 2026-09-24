// Replays the committed capabilities against a fixture it starts itself, through the stack the
// replay CLI ships, with no reasoner and no model configuration, and checks each scenario's
// result. Evidence goes to a temp dir, or to evidence/runs with --keep.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { PassThrough } from 'node:stream';
import { parseArgs } from 'node:util';
import { buildReplayStack } from '../src/diplomat/composition/replay';
import { loadPolicy, type StackOverrides } from '../src/diplomat/composition/shared';
import { createCliBroker } from '../src/diplomat/escalation/cli-broker';
import { createPlaywrightDriver } from '../src/diplomat/surface/playwright-driver';
import { loadConfig, REPO_ROOT, type Config } from '../src/infrastructure/config';
import type { ExecutionResult, Recovery } from '../src/models/execution-result';
import type { Policy } from '../src/models/policy';
import { armBefore, fixturePolicy, startFixture, type ArmPlan, type FixtureHandle } from './lib/fixture';
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERNAME,
  JAMES,
  JAMES_SAVINGS_BALANCE,
  MARIA,
  MARIA_SAVINGS_BALANCE,
  NOT_FOUND,
  RESTRICTED,
} from './lib/fixture-data';
import type { HumanActor } from './lib/human-actor';
import { operatorClosesAccount } from './lib/scripted-operator';

const MODEL_ENV = /^(OLLAMA_BASE_URL|REASONER_MODEL|HOSTED_.*)$/;

type Scenario = {
  readonly name: string;
  readonly capability: string;
  readonly inputs: Record<string, string>;
  readonly fault?: ArmPlan;
  readonly operator?: () => HumanActor;
  readonly expected: string;
  readonly holds: (result: ExecutionResult) => boolean;
};

const READ_BALANCE = 'member.read-account-balance';
const CLOSE_ACCOUNT = 'member.close-account';

function recoveryName(recovery: Recovery): string {
  return recovery.condition === 'outcome' ? recovery.outcomeId : recovery.condition;
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'success',
    capability: READ_BALANCE,
    inputs: JAMES,
    expected: 'succeeded',
    holds: (result) => result.status === 'succeeded' && result.outputs.balance === JAMES_SAVINGS_BALANCE,
  },
  {
    name: 'business outcome',
    capability: READ_BALANCE,
    inputs: NOT_FOUND,
    expected: 'business_outcome:member_not_found',
    holds: (result) => result.status === 'business_outcome' && result.outcome === 'member_not_found',
  },
  {
    name: 'permission denied',
    capability: READ_BALANCE,
    inputs: RESTRICTED,
    expected: 'business_outcome:member_restricted',
    holds: (result) => result.status === 'business_outcome' && result.outcome === 'member_restricted',
  },
  {
    name: 'recovered fault',
    capability: READ_BALANCE,
    inputs: MARIA,
    fault: { stepId: 'click-member-lookup', kind: 'interstitial' },
    expected: 'succeeded+recovery:interstitial',
    holds: (result) =>
      result.status === 'succeeded' &&
      result.outputs.balance === MARIA_SAVINGS_BALANCE &&
      result.recoveries.some((recovery) => recovery.condition === 'outcome' && recovery.outcomeId === 'interstitial'),
  },
  {
    name: 'unexpected dialog',
    capability: READ_BALANCE,
    inputs: MARIA,
    fault: { stepId: 'click-member-lookup', kind: 'unexpected_dialog' },
    expected: 'succeeded+recovery:unexpected_dialog',
    holds: (result) =>
      result.status === 'succeeded' &&
      result.outputs.balance === MARIA_SAVINGS_BALANCE &&
      result.recoveries.map(recoveryName).includes('unexpected_dialog'),
  },
  {
    name: 'hard failure',
    capability: READ_BALANCE,
    inputs: MARIA,
    fault: { stepId: 'click-member-lookup', kind: 'server_error' },
    expected: 'failed:server_error@click-member-lookup',
    holds: (result) =>
      result.status === 'failed' &&
      result.failure.code === 'server_error' &&
      result.failure.stepId === 'click-member-lookup' &&
      result.failure.expected !== '' &&
      result.failure.observed !== '',
  },
  {
    name: 'handoff (scripted operator)',
    capability: CLOSE_ACCOUNT,
    inputs: { memberId: MARIA.memberId },
    operator: operatorClosesAccount,
    expected: 'succeeded+intervention',
    holds: (result) => result.status === 'succeeded' && result.interventions.length === 1,
  },
  {
    name: 'escalation, no operator',
    capability: CLOSE_ACCOUNT,
    inputs: { memberId: MARIA.memberId },
    expected: 'escalated:no_operator_surface@close-account',
    holds: (result) => result.status === 'escalated' && result.reason === 'no_operator_surface',
  },
];

function describe(result: ExecutionResult): string {
  switch (result.status) {
    case 'succeeded': {
      const recoveries = result.recoveries.map((recovery) => `+recovery:${recoveryName(recovery)}`).join('');
      return `succeeded${recoveries}${result.interventions.length > 0 ? '+intervention' : ''}`;
    }
    case 'business_outcome':
      return `business_outcome:${result.outcome}`;
    case 'failed':
      return `failed:${result.failure.code}@${result.failure.stepId}`;
    case 'escalated':
      return `escalated:${result.reason}@${result.stepId}`;
    default: {
      const unhandled: never = result;
      return unhandled;
    }
  }
}

function shown(path: string): string {
  const shownPath = relative(process.cwd(), path);
  return shownPath.startsWith('..') || isAbsolute(shownPath) ? path : shownPath;
}

// The replay CLI's stack; only the operator's terminal, the operator's hands on the page and
// the fault injection are the demo's own.
async function replayScenario(fixture: FixtureHandle, scenario: Scenario, config: Config, policy: Policy): Promise<ExecutionResult> {
  const operator = scenario.operator?.();
  const driver = operator === undefined ? undefined : createPlaywrightDriver({ exposePageForTests: true });
  const { fault } = scenario;
  const overrides: StackOverrides = {
    broker: operator?.broker ?? createCliBroker({ input: new PassThrough(), output: new PassThrough() }),
    humanSurfaceAvailable: operator !== undefined,
    ...(driver === undefined ? {} : { driver }),
    ...(fault === undefined ? {} : { wrapGateway: (gateway) => armBefore(gateway, fixture, fault) }),
  };
  const stack = buildReplayStack(config, policy, { headed: false }, overrides);
  if (operator !== undefined && driver !== undefined) {
    operator.attach({
      get page() {
        return driver.page();
      },
      gateway: stack.gateway,
    });
  }
  try {
    const result = await stack.run({ capabilityId: scenario.capability, major: 1, inputs: scenario.inputs, targetUrl: `${fixture.baseUrl}/` });
    const errors = operator?.errors ?? [];
    if (errors.length > 0) throw new Error(`scripted operator failed: ${errors.map(String).join('; ')}`);
    return result;
  } finally {
    await stack.close();
  }
}

async function runScenario(fixture: FixtureHandle, scenario: Scenario, config: Config, policy: Policy): Promise<boolean> {
  let result: ExecutionResult;
  try {
    result = await replayScenario(fixture, scenario, config, policy);
  } catch (error) {
    process.stdout.write(`FAIL  ${scenario.name.padEnd(28)} expected=${scenario.expected}  error=${error instanceof Error ? error.message : String(error)}\n`);
    return false;
  }
  const passed = scenario.holds(result);
  process.stdout.write(
    `${passed ? 'PASS' : 'FAIL'}  ${scenario.name.padEnd(28)} expected=${scenario.expected}  got=${describe(result)}  evidence=${shown(join(config.evidenceDir, result.runId))}\n`,
  );
  if (!passed) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return passed;
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { keep: { type: 'boolean' } }, strict: true });
  for (const key of Object.keys(process.env)) {
    if (MODEL_ENV.test(key)) Reflect.deleteProperty(process.env, key);
  }
  const evidenceDir = values.keep === true ? join(REPO_ROOT, 'evidence', 'runs') : await mkdtemp(join(tmpdir(), 'demo-evidence-'));
  const config: Config = { ...loadConfig(), targetUsername: FIXTURE_USERNAME, targetPassword: FIXTURE_PASSWORD, evidenceDir };
  const committed = await loadPolicy();
  if (!committed.ok) throw new Error(committed.issues.join('; '));

  const fixture = await startFixture();
  const policy = fixturePolicy(committed.policy, fixture);
  process.stdout.write(`fixture: ${fixture.baseUrl} (started by the demo)\nevidence: ${shown(evidenceDir)}\n\n`);
  let passed = 0;
  try {
    for (const scenario of SCENARIOS) {
      if (await runScenario(fixture, scenario, config, policy)) passed += 1;
    }
  } finally {
    await fixture.stop();
  }
  const all = passed === SCENARIOS.length;
  process.stdout.write(
    `\n${String(passed)}/${String(SCENARIOS.length)} ${all ? 'as expected' : 'as expected — some scenarios diverged'} — replay ran with no reasoner and no model env\n`,
  );
  return all ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`demo: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
