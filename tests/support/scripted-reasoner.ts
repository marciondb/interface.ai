import type { Reasoner, ReasonerInput } from '../../src/diplomat/reasoner/port';
import type { AgentDecision, Verb } from '../../src/models/action';
import type { ObservationNode } from '../../src/models/observation';

// How a scripted step picks its element: by what the screen shows, never by a fixed ref.
export type Find = {
  readonly role: string;
  readonly name?: string;
  readonly label?: string;
  readonly frame?: string | null;
};

export type ScriptedStep =
  | { readonly verb: Verb; readonly find?: Find; readonly argument?: string }
  // Full control, e.g. to answer with a ref that is not on the screen.
  | ((input: ReasonerInput) => AgentDecision);

export type ScriptedReasoner = Reasoner & { readonly inputs: ReasonerInput[] };

function matches(node: ObservationNode, find: Find): boolean {
  return (
    node.ref !== undefined &&
    node.role === find.role &&
    (find.name === undefined || node.name === find.name) &&
    (find.label === undefined || node.label === find.label) &&
    (find.frame === undefined || node.frame === find.frame)
  );
}

class ScriptExhausted extends Error {
  override readonly name = 'ReasonerError';
}

// A Reasoner that answers from a script, one step per call; past the end it fails like a
// reasoner that exhausted its retries.
export function createScriptedReasoner(script: readonly ScriptedStep[]): ScriptedReasoner {
  const inputs: ReasonerInput[] = [];
  return {
    adapter: 'ollama',
    model: 'scripted',
    inputs,
    propose(input) {
      inputs.push(input);
      const step = script.at(inputs.length - 1);
      if (step === undefined) return Promise.reject(new ScriptExhausted('script exhausted'));
      if (typeof step === 'function') return Promise.resolve(step(input));
      let target: string | null = null;
      if (step.find !== undefined) {
        const { find } = step;
        const node = input.observation.nodes.find((candidate) => matches(candidate, find));
        if (node?.ref === undefined) return Promise.reject(new ScriptExhausted(`no element matches ${JSON.stringify(find)}`));
        target = node.ref;
      }
      return Promise.resolve({ verb: step.verb, target, argument: step.argument ?? null, rationale: `scripted ${step.verb}` });
    },
  };
}

// The read flow a person would take on the fixture for member 10001's Savings balance.
export const READ_FLOW: readonly ScriptedStep[] = [
  { verb: 'click', find: { role: 'link', name: 'Member Lookup' } },
  { verb: 'fill', find: { role: 'textbox', label: 'Member ID' }, argument: '10001' },
  { verb: 'click', find: { role: 'button', name: 'Search' } },
  { verb: 'click', find: { role: 'link', name: 'Maria Santos' } },
  { verb: 'read', find: { role: 'cell', name: '4,812.37' }, argument: 'balance' },
  { verb: 'finish', argument: 'read the Savings balance' },
];

// The write flow up to the review, where the model asks to click Confirm (a human does it).
export const WRITE_FLOW_TO_CONFIRM: readonly ScriptedStep[] = [
  ...READ_FLOW.slice(0, 4),
  { verb: 'click', find: { role: 'button', name: 'Open Sub-Account' } },
  { verb: 'select', find: { role: 'combobox', label: 'Account Type' }, argument: 'Money Market' },
  { verb: 'fill', find: { role: 'textbox', label: 'Nickname' }, argument: 'Rainy Day' },
  { verb: 'fill', find: { role: 'textbox', label: '$' }, argument: '250.00' },
  { verb: 'click', find: { role: 'button', name: 'Continue' } },
  { verb: 'click', find: { role: 'button', name: 'Confirm' } },
];

// The whole write flow for member 10001, once the human has confirmed.
export const WRITE_FLOW: readonly ScriptedStep[] = [
  ...WRITE_FLOW_TO_CONFIRM,
  { verb: 'read', find: { role: 'cell', name: '10001MMRAIN025000' }, argument: 'accountNumber' },
  { verb: 'finish', argument: 'opened the sub-account' },
];
