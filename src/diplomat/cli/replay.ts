import { join } from 'node:path';
import { toReplayRequest } from '../../adapters/replay-args';
import { buildReplayStack } from '../composition/replay';
import { loadPolicyFor } from '../composition/shared';
import { createCli, replayExitCode } from './command';

const cli = createCli(
  'replay',
  'usage: npm run replay -- --capability <id>@<major> [--input name=value]... [--target <url>] [--headed] [--allow-draft]',
);

async function main(argv: string[]): Promise<number> {
  const flags = cli.flags(argv, {
    capability: { type: 'string' },
    input: { type: 'string', multiple: true },
    target: { type: 'string' },
    headed: { type: 'boolean' },
    'allow-draft': { type: 'boolean' },
  });
  if (!flags.ok) return cli.usageError(flags.issue);
  const args = toReplayRequest(flags.values);
  if (!args.ok) return cli.usageError(...args.issues);
  const { request, headed, allowDraft } = args;

  const loaded = cli.config();
  if (!loaded.ok) return cli.usageError(loaded.issue);
  const { config } = loaded;
  const policy = await loadPolicyFor(request.targetUrl);
  if (!policy.ok) return cli.usageError(...policy.issues);

  const stack = buildReplayStack(config, policy.policy, { headed, allowDraft });
  try {
    const result = await stack.run(request);
    // The caller's channel: outputs are unmasked here, unlike in the evidence.
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.stderr.write(`evidence: ${cli.shown(join(config.evidenceDir, result.runId))}\n`);
    return replayExitCode(result);
  } finally {
    await stack.close();
  }
}

cli.run(main);
