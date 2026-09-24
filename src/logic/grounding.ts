import type { Observation, ObservationNode, Ref } from '../models/observation';

export function observationRefs(observation: Observation): Ref[] {
  return observation.nodes.flatMap((node) => (node.ref === undefined ? [] : [node.ref]));
}

export function findNode(observation: Observation, ref: string): ObservationNode | undefined {
  return observation.nodes.find((node) => node.ref === ref);
}

export function hasRef(observation: Observation, ref: string | null): boolean {
  return ref !== null && findNode(observation, ref) !== undefined;
}
