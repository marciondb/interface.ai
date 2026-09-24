// Replays the committed capabilities against a fixture it starts itself, with no reasoner and
// no model configuration, and checks each scenario's result. Evidence goes to a temp dir, or to
// evidence/runs with --keep.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/infrastructure/config';
import type { ExecutionResult } from '../src/models/execution-result';
import { startFixture, type FaultKind, type FixtureHandle } from '../tests/support/fixture';
import type { HumanActor } from '../tests/support/human-actor';
import { runReplay } from '../tests/support/replay-harness';
import { operatorClosesAccount } from '../tests/support/scripted-operator';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MODEL_ENV = /^(OLLAMA_BASE_URL|REASONER_MODEL|HOSTED_.*)$/;

type Scenario = {
  readonly name: string;
  readonly capability: string;
  readonly inputs: Record<string, string>;
  readonly fault?: { readonly stepId: string; readonly kind: FaultKind };
  readonly operator?: () => HumanActor;
  readonly expected: string;
  readonly holds: (result: ExecutionResult) => boolean;
};

const READ_BALANCE = 'member.read-account-balance';
const CLOSE_ACCOUNT = 'member.close-account';

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'success',
    capability: READ_BALANCE,
    inputs: { memberId: '10002', accountType: 'Savings' },
    expected: 'succeeded',
    holds: (result) => result.status === 'succeeded' && result.outputs.balance === '3,100.55',
  },
  {
    name: 'business outcome',
    capability: READ_BALANCE,
    inputs: { memberId: '99999', accountType: 'Savings' },
    expected: 'business_outcome:member_not_found',
    holds: (result) => result.status === 'business_outcome' && result.outcome === 'member_not_found',
  },
  {
    name: 'recovered fault',
    capability: READ_BALANCE,
    inputs: { memberId: '10001', accountType: 'Savings' },
    fault: { stepId: 'click-member-lookup', kind: 'interstitial' },
    expected: 'succeeded+recovery:interstitial',
    holds: (result) =>
      result.status === 'succeeded' &&
      result.outputs.balance === '4,812.37' &&
      result.recoveries.some((recovery) => recovery.condition === 'interstitial'),
  },
  {
    name: 'hard failure',
    capability: READ_BALANCE,
    inputs: { memberId: '10001', accountType: 'Savings' },
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
    inputs: { memberId: '10001' },
    operator: operatorClosesAccount,
    expected: 'succeeded+intervention',
    holds: (result) => result.status === 'succeeded' && result.interventions.length === 1,
  },
  {
    name: 'escalation, no operator',
    capability: CLOSE_ACCOUNT,
    inputs: { memberId: '10001' },
    expected: 'escalated:no_operator_surface@close-account',
    holds: (result) => result.status === 'escalated' && result.reason === 'no_operator_surface',
  },
];

function describe(result: ExecutionResult): string {
  switch (result.status) {
    case 'succeeded': {
      const recoveries = result.recoveries.map((recovery) => `+recovery:${recovery.condition}`).join('');
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

async function runScenario(fixture: FixtureHandle, scenario: Scenario, evidenceRoot: string, stepTimeoutMs: number): Promise<boolean> {
  const operator = scenario.operator?.();
  const { result } = await runReplay(fixture, scenario.inputs, {
    capability: scenario.capability,
    evidenceRoot,
    stepTimeoutMs,
    ...(scenario.fault === undefined ? {} : { arm: scenario.fault }),
    ...(operator === undefined ? {} : { operator }),
  });
  const passed = scenario.holds(result) && (operator?.errors ?? []).length === 0;
  const evidence = join(evidenceRoot, result.runId);
  process.stdout.write(
    `${passed ? 'PASS' : 'FAIL'}  ${scenario.name.padEnd(28)} expected=${scenario.expected}  got=${describe(result)}  evidence=${evidence}\n`,
  );
  if (!passed) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return passed;
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { keep: { type: 'boolean' } }, strict: true });
  for (const key of Object.keys(process.env)) {
    if (MODEL_ENV.test(key)) Reflect.deleteProperty(process.env, key);
  }
  const { replayStepTimeoutMs } = loadConfig();
  const evidenceRoot = values.keep === true ? relative(process.cwd(), join(ROOT, 'evidence', 'runs')) : await mkdtemp(join(tmpdir(), 'demo-evidence-'));

  const fixture = await startFixture();
  process.stdout.write(`fixture: ${fixture.baseUrl} (started by the demo)\nevidence: ${evidenceRoot}\n\n`);
  let passed = 0;
  try {
    for (const scenario of SCENARIOS) {
      if (await runScenario(fixture, scenario, evidenceRoot, replayStepTimeoutMs)) passed += 1;
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
