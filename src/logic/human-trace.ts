import type { HumanAction, HumanTarget } from '../models/intervention';
import type { Observation, ObservationNode } from '../models/observation';

function only(nodes: readonly ObservationNode[]): ObservationNode | undefined {
  return nodes.length === 1 ? nodes[0] : undefined;
}

// The addressable element of the observation a human acted on: same frame, same role and
// accessible name. undefined when none or several match.
export function matchHumanTarget(target: HumanTarget, observation: Observation): ObservationNode | undefined {
  const inFrame = observation.nodes.filter((node) => node.ref !== undefined && node.frame === target.frame);
  const { role, name } = target;
  if (role === undefined || name === undefined || name === '') return undefined;
  return only(inFrame.filter((node) => node.role === role && node.name === name));
}

function targetText({ role, name, tag }: HumanTarget): string {
  return name === undefined || name === '' ? (role ?? tag) : `${role ?? tag} ${JSON.stringify(name)}`;
}

// What the model is told a human did; navigations only follow from the other actions.
export function describeHumanAction(action: HumanAction): string | undefined {
  switch (action.kind) {
    case 'click':
      return `click ${targetText(action.target)}`;
    case 'input':
      return `type into ${targetText(action.target)}`;
    case 'dialog':
      return `${action.decision} the dialog ${JSON.stringify(action.message)}`;
    case 'navigation':
      return undefined;
    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}
