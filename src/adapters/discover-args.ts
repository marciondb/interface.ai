import { DiscoverArgsInSchema } from '../wire/in/discover-args';
import { DEFAULT_TARGET } from './replay-args';

export type ReasonerChoice = 'local' | 'hosted';

export type DiscoverArgs = {
  readonly requestPath: string;
  readonly reasoner: ReasonerChoice;
  readonly targetUrl: string;
  readonly headed: boolean;
};

export type DiscoverArgsResult = { ok: true; args: DiscoverArgs } | { ok: false; issues: string[] };

function targetUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function toDiscoverArgs(raw: unknown): DiscoverArgsResult {
  const parsed = DiscoverArgsInSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((issue) => `--${issue.path.map(String).join('.')}: ${issue.message}`) };
  const args = parsed.data;
  const issues: string[] = [];

  if (args.request === undefined || args.request === '') issues.push('--request is required, as a path to a capability request file');
  const reasoner = args.reasoner ?? 'local';
  if (reasoner !== 'local' && reasoner !== 'hosted') issues.push('--reasoner must be local or hosted');
  const target = targetUrl(args.target ?? DEFAULT_TARGET);
  if (target === undefined) issues.push('--target must be an http(s) URL');

  if (issues.length > 0 || args.request === undefined || target === undefined || (reasoner !== 'local' && reasoner !== 'hosted')) {
    return { ok: false, issues };
  }
  return { ok: true, args: { requestPath: args.request, reasoner, targetUrl: target, headed: args.headed ?? false } };
}
