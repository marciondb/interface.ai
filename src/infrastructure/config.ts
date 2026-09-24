import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// capabilities/, policy.json, discovery/ and relative EVIDENCE_DIR resolve from here, not the cwd.
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export type Config = {
  readonly targetUsername: string;
  readonly targetPassword: string;
  readonly ollamaBaseUrl: string;
  readonly reasonerModel: string;
  readonly hosted: {
    readonly baseUrl: string | undefined;
    readonly model: string | undefined;
    readonly apiKey: string | undefined;
  };
  // Root of the per-run evidence folders (ADR-014); absolute.
  readonly evidenceDir: string;
  // Budget for each replay step phase: finding the target, the action, the checkpoint (RFC-004).
  readonly replayStepTimeoutMs: number;
  // Budget for each discovery action and the page loads it starts (RFC-003).
  readonly discoveryStepTimeoutMs: number;
  // How long a human handoff may wait before the run ends escalated (RFC-005).
  readonly handoffTtlMs: number;
  // Who is recorded as taking and resuming a handoff.
  readonly operatorId: string;
};

function read(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === '' ? undefined : value;
}

function positiveInteger(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = read(env, key);
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${key} must be a positive integer`);
  return Number(value);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    targetUsername: read(env, 'TARGET_USERNAME') ?? 'operator',
    targetPassword: read(env, 'TARGET_PASSWORD') ?? 'training',
    ollamaBaseUrl: read(env, 'OLLAMA_BASE_URL') ?? 'http://localhost:11434',
    reasonerModel: read(env, 'REASONER_MODEL') ?? 'qwen3:14b',
    hosted: {
      baseUrl: read(env, 'HOSTED_BASE_URL'),
      model: read(env, 'HOSTED_MODEL'),
      apiKey: read(env, 'HOSTED_API_KEY'),
    },
    evidenceDir: resolve(REPO_ROOT, read(env, 'EVIDENCE_DIR') ?? 'evidence/runs'),
    replayStepTimeoutMs: positiveInteger(env, 'REPLAY_STEP_TIMEOUT_MS', 5_000),
    discoveryStepTimeoutMs: positiveInteger(env, 'DISCOVERY_STEP_TIMEOUT_MS', 5_000),
    handoffTtlMs: positiveInteger(env, 'HANDOFF_TTL_MS', 600_000),
    operatorId: read(env, 'OPERATOR_ID') ?? 'local-operator',
  };
}
