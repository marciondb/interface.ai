import { CapabilityIdSchema } from '../models/capability';
import type { ReplayRequest } from '../models/replay-request';
import { ReplayArgsInSchema } from '../wire/in/replay-args';

export const DEFAULT_TARGET = 'http://localhost:8080';

export type ReplayArgsResult =
  | { ok: true; request: ReplayRequest; headed: boolean }
  | { ok: false; issues: string[] };

const REFERENCE = /^([^@]+)@([0-9]+)$/;

function targetUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function toReplayRequest(raw: unknown): ReplayArgsResult {
  const parsed = ReplayArgsInSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((issue) => `--${issue.path.map(String).join('.')}: ${issue.message}`) };
  const args = parsed.data;
  const issues: string[] = [];

  const reference = args.capability === undefined ? undefined : REFERENCE.exec(args.capability);
  if (args.capability === undefined) issues.push('--capability is required, as <id>@<major>');
  else if (reference === null || reference === undefined) issues.push('--capability must look like <id>@<major>, e.g. member.read-account-balance@1');
  else if (!CapabilityIdSchema.safeParse(reference[1]).success) issues.push(`--capability id ${JSON.stringify(reference[1])} is malformed`);

  // Values are never echoed: inputs may be sensitive.
  const inputs: Record<string, string> = {};
  for (const pair of args.input ?? []) {
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator);
    if (separator <= 0) issues.push('--input must look like name=value');
    else if (Object.hasOwn(inputs, name)) issues.push(`--input ${name} is given more than once`);
    else inputs[name] = pair.slice(separator + 1);
  }

  const target = targetUrl(args.target ?? DEFAULT_TARGET);
  if (target === undefined) issues.push('--target must be an http(s) URL');

  if (issues.length > 0 || reference === null || reference === undefined || target === undefined) return { ok: false, issues };
  return {
    ok: true,
    request: { capabilityId: reference[1], major: Number(reference[2]), inputs, targetUrl: target },
    headed: args.headed ?? false,
  };
}
