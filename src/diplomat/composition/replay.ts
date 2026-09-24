import { replay } from '../../controllers/replay';
import type { Config } from '../../infrastructure/config';
import type { ExecutionResult } from '../../models/execution-result';
import type { Policy } from '../../models/policy';
import type { ReplayRequest } from '../../models/replay-request';
import type { ActionGateway } from '../gateway/port';
import { buildCommonStack, type StackOverrides, type StackSettings } from './shared';

export type ReplayStackSettings = StackSettings & {
  // Also replays draft artifacts, i.e. discovered and not yet approved.
  readonly allowDraft?: boolean;
  // Default: config.replayStepTimeoutMs.
  readonly stepTimeoutMs?: number;
};

export type ReplayStack = {
  // What the controller acts through, for an operator script that checks automation is refused.
  readonly gateway: ActionGateway;
  run(request: ReplayRequest): Promise<ExecutionResult>;
  // Closes the broker and the browser.
  close(): Promise<void>;
};

// The replay path, with no reasoner anywhere in it (ADR-001).
export function buildReplayStack(config: Config, policy: Policy, settings: ReplayStackSettings, overrides: StackOverrides = {}): ReplayStack {
  const common = buildCommonStack(config, policy, { ...settings, includeDrafts: settings.allowDraft ?? false }, [config.targetPassword], overrides);
  return {
    gateway: common.deps.gateway,
    run: (request) => replay(common.deps, request, { stepTimeoutMs: settings.stepTimeoutMs ?? config.replayStepTimeoutMs }),
    close: () => common.close(),
  };
}
