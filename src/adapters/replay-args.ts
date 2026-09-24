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

  const [, capabilityId, major] = (args.capability === undefined ? null : REFERENCE.exec(args.capability)) ?? [];
  if (args.capability === undefined) issues.push('--capability is required, as <id>@<major>');
  else if (capabilityId === undefined || major === undefined) issues.push('--capability must look like <id>@<major>, e.g. member.read-account-balance@1');
  else if (!CapabilityIdSchema.safeParse(capabilityId).success) issues.push(`--capability id ${JSON.stringify(capabilityId)} is malformed`);

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

  if (issues.length > 0 || capabilityId === undefined || major === undefined || target === undefined) return { ok: false, issues };
  return {
    ok: true,
    request: { capabilityId, major: Number(major), inputs, targetUrl: target },
    headed: args.headed ?? false,
  };
}
