import { join } from 'node:path';
import { toDiscoverArgs, toGoalRequest, withVersion, type DiscoverArgs } from '../../adapters/discover-args';
import { REPO_ROOT } from '../../infrastructure/config';
import { errorMessage } from '../../infrastructure/errors';
import { checkRequest } from '../../logic/capability-request';
import type { CapabilityRequest } from '../../models/capability-request';
import type { OutcomeCatalog } from '../../models/outcome-catalog';
import { buildDiscoveryStack, createReasoner } from '../composition/discovery';
import { CAPABILITIES_DIR, loadPolicyFor } from '../composition/shared';
import type { Reasoner } from '../reasoner/port';
import { loadCatalog, loadRequest } from '../store/discovery-inputs';
import { createCli, discoveryExitCode } from './command';
import { discoverySecrets, narrated } from './discover-support';

const CATALOGS_DIR = join(REPO_ROOT, 'discovery', 'catalogs');

const cli = createCli(
  'discover',
  [
    'usage: npm run discover -- --request <file> [--version x.y.z] [--reasoner local|hosted] [--target <url>] [--headed]',
    '       npm run discover -- --goal <text> --capability <id> [--input name=example[:sensitivity]]... --output name[:sensitivity]...',
    '                           [--outcome <catalog id>]... [--version x.y.z] [--reasoner local|hosted] [--target <url>] [--headed]',
  ].join('\n'),
);

type Loaded = { ok: true; request: CapabilityRequest; catalog: OutcomeCatalog } | { ok: false; issues: string[] };

async function loadTask(args: DiscoverArgs): Promise<Loaded> {
  const { source } = args;
  switch (source.kind) {
    case 'file': {
      const request = await loadRequest(source.path);
      if (!request.ok) return request;
      const catalog = await loadCatalog(CATALOGS_DIR, request.request.capability.app.product);
      if (!catalog.ok) return catalog;
      const problems = checkRequest(request.request, catalog.catalog).map((problem) => `${source.path}: ${problem}`);
      return problems.length > 0 ? { ok: false, issues: problems } : { ok: true, request: withVersion(request.request, args.version), catalog: catalog.catalog };
    }
    case 'goal': {
      const catalog = await loadCatalog(CATALOGS_DIR, source.goal.product);
      if (!catalog.ok) return catalog;
      const request = toGoalRequest(source.goal, catalog.catalog, args.version);
      if (!request.ok) return request;
      const problems = checkRequest(request.request, catalog.catalog);
      return problems.length > 0 ? { ok: false, issues: problems } : { ok: true, request: request.request, catalog: catalog.catalog };
    }
    default: {
      const unhandled: never = source;
      return unhandled;
    }
  }
}

async function main(argv: string[]): Promise<number> {
  const flags = cli.flags(argv, {
    request: { type: 'string' },
    goal: { type: 'string' },
    capability: { type: 'string' },
    input: { type: 'string', multiple: true },
    output: { type: 'string', multiple: true },
    outcome: { type: 'string', multiple: true },
    version: { type: 'string' },
    reasoner: { type: 'string' },
    target: { type: 'string' },
    headed: { type: 'boolean' },
  });
  if (!flags.ok) return cli.usageError(flags.issue);
  const parsed = toDiscoverArgs(flags.values);
  if (!parsed.ok) return cli.usageError(...parsed.issues);
  const { args } = parsed;

  const loaded = cli.config();
  if (!loaded.ok) return cli.usageError(loaded.issue);
  const { config } = loaded;
  const task = await loadTask(args);
  if (!task.ok) return cli.usageError(...task.issues);
  const policy = await loadPolicyFor(args.targetUrl);
  if (!policy.ok) return cli.usageError(...policy.issues);

  let reasoner: Reasoner;
  try {
    reasoner = createReasoner(args.reasoner, config);
  } catch (error) {
    return cli.usageError(`--reasoner ${args.reasoner}: ${errorMessage(error)}`);
  }

  const stack = buildDiscoveryStack(
    config,
    policy.policy,
    { headed: args.headed, reasoner, secrets: discoverySecrets(args.reasoner, config) },
    { wrapEvidence: (recorder) => narrated(recorder, process.stderr) },
  );
  try {
    const result = await stack.run({ request: task.request, catalog: task.catalog, targetUrl: args.targetUrl });
    // The caller's channel: outputs are unmasked here, unlike in the evidence.
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === 'succeeded') {
      process.stderr.write(`artifact: ${cli.shown(join(CAPABILITIES_DIR, result.capability.id, `${result.capability.version}.json`))}\n`);
    }
    process.stderr.write(`evidence: ${cli.shown(join(config.evidenceDir, result.runId))}\n`);
    return discoveryExitCode(result);
  } finally {
    await stack.close();
  }
}

cli.run(main);
