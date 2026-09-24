import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT } from '../../../../src/diplomat/cli/command';
import { REPO_ROOT } from '../../../../src/infrastructure/config';

type Exit = { code: number; stdout: string; stderr: string };

const MODEL_ENV = /^(OLLAMA_BASE_URL|REASONER_MODEL|HOSTED_.*|EVIDENCE_DIR)$/;
const GOAL = 'Look up member {{memberId}} and read the balance of their {{accountType}} account';

// The CLI as npm runs it, with no model configuration.
function cli(command: 'replay' | 'discover', args: readonly string[], env: Record<string, string> = {}): Promise<Exit> {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !MODEL_ENV.test(key)));
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', join(REPO_ROOT, 'src/diplomat/cli', `${command}.ts`), ...args],
      { cwd: REPO_ROOT, env: { ...clean, ...env } },
      (error, stdout, stderr) => {
        resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : -1, stdout, stderr });
      },
    );
  });
}

describe('CLI exit codes', () => {
  it('exits with the usage code and the usage on a bad flag', async () => {
    const replay = await cli('replay', ['--capability']);
    const discover = await cli('discover', ['--request', 'r.json', '--goal', GOAL]);

    expect(replay.code).toBe(EXIT.usage);
    expect(replay.stderr).toContain('usage: npm run replay');
    expect(discover.code).toBe(EXIT.usage);
    expect(discover.stderr).toContain('--request and --goal are exclusive');
    expect(discover.stderr).toContain('npm run discover -- --goal <text>');
  });

  it('refuses a target outside the policy before launching anything', async () => {
    const { code, stdout, stderr } = await cli('replay', ['--capability', 'member.read-account-balance@1', '--target', 'http://example.com']);

    expect(code).toBe(EXIT.usage);
    expect(stdout).toBe('');
    expect(stderr).toContain('--target is outside the policy allowlist');
  });

  it('builds a request from --goal, checked against the catalog, before it needs a reasoner', async () => {
    const args = ['--goal', GOAL, '--capability', 'member.read-account-balance', '--input', 'memberId=10001', '--input', 'accountType=Savings:none'];
    const valid = await cli('discover', [...args, '--output', 'balance:financial', '--version', '9.0.0', '--reasoner', 'hosted']);
    const unknownOutcome = await cli('discover', [...args, '--output', 'balance', '--outcome', 'no_such_outcome']);

    expect(valid.code).toBe(EXIT.usage);
    expect(valid.stderr).toContain('--reasoner hosted: ');
    expect(unknownOutcome.code).toBe(EXIT.usage);
    expect(unknownOutcome.stderr).toContain('outcomes: no_such_outcome is not in the legacy-member-console catalog');
  });

  it('exits with the internal-error code when the run crashes', async () => {
    const notADirectory = join(await mkdtemp(join(tmpdir(), 'cli-exit-')), 'file');
    await writeFile(notADirectory, '');

    const { code, stderr } = await cli('replay', ['--capability', 'member.read-account-balance@1', '--input', 'memberId=10001'], { EVIDENCE_DIR: notADirectory });

    expect(code).toBe(EXIT.internal);
    expect(stderr).toContain('replay: internal error:');
  });
});
