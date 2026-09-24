import type { ReasonerChoice } from '../../adapters/discover-args';
import { discover } from '../../controllers/discovery';
import type { Config } from '../../infrastructure/config';
import type { CapabilityRequest } from '../../models/capability-request';
import type { DiscoveryLimits, DiscoveryResult } from '../../models/discovery';
import type { OutcomeCatalog } from '../../models/outcome-catalog';
import type { Policy } from '../../models/policy';
import type { ActionGateway } from '../gateway/port';
import { createOllamaReasoner } from '../reasoner/ollama';
import { createOpenAiCompatibleReasoner } from '../reasoner/openai-compatible';
import type { Reasoner } from '../reasoner/port';
import { buildCommonStack, type StackOverrides, type StackSettings } from './shared';

// Throws when the hosted reasoner is not configured.
export function createReasoner(choice: ReasonerChoice, config: Config): Reasoner {
  switch (choice) {
    case 'local':
      return createOllamaReasoner({ baseUrl: config.ollamaBaseUrl, model: config.reasonerModel });
    case 'hosted':
      return createOpenAiCompatibleReasoner(config.hosted);
    default: {
      const unhandled: never = choice;
      return unhandled;
    }
  }
}

export type DiscoveryStackSettings = StackSettings & {
  readonly reasoner: Reasoner;
  // Masked in the evidence and in the model's input (default: the target password).
  readonly secrets?: readonly string[];
  // Default: config.discoveryStepTimeoutMs.
  readonly stepTimeoutMs?: number;
  readonly limits?: DiscoveryLimits;
};

export type DiscoveryTask = {
  // Checked against the catalog beforehand (checkRequest).
  readonly request: CapabilityRequest;
  readonly catalog: OutcomeCatalog;
  readonly targetUrl: string;
};

export type DiscoveryStack = {
  readonly gateway: ActionGateway;
  run(task: DiscoveryTask): Promise<DiscoveryResult>;
  close(): Promise<void>;
};

export function buildDiscoveryStack(config: Config, policy: Policy, settings: DiscoveryStackSettings, overrides: StackOverrides = {}): DiscoveryStack {
  const secrets = settings.secrets ?? [config.targetPassword];
  const common = buildCommonStack(config, policy, settings, secrets, overrides);
  return {
    gateway: common.deps.gateway,
    run: (task) =>
      discover(
        { ...common.deps, reasoner: settings.reasoner },
        { ...task, secrets },
        { stepTimeoutMs: settings.stepTimeoutMs ?? config.discoveryStepTimeoutMs, ...(settings.limits === undefined ? {} : { limits: settings.limits }) },
      ),
    close: () => common.close(),
  };
}
