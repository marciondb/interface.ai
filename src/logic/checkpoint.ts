import { predicateTarget, type Candidate, type Predicate } from '../models/capability';
import type { Observation } from '../models/observation';

// What the surface showed for one named target when the facts were gathered.
export type TargetFact = {
  readonly candidates: readonly Candidate[];
  readonly counts: readonly number[];
  readonly resolved: boolean;
  // Form value or element text; present only when a predicate needed it and the target resolved.
  readonly value?: string;
};

export type Facts = {
  readonly observation: Observation;
  readonly targets: Readonly<Record<string, TargetFact>>;
};

export type PredicateResult = {
  readonly holds: boolean;
  readonly expected: string;
  readonly observed: string;
};

export type FactRequest = { readonly target: string; readonly needsValue: boolean };

// Targets the predicates look at, and whether their value must be read.
export function factsNeeded(predicates: readonly Predicate[]): FactRequest[] {
  const needed = new Map<string, boolean>();
  for (const predicate of predicates) {
    const target = predicateTarget(predicate);
    if (target === undefined) continue;
    const needsValue = predicate.kind === 'value_equals' || predicate.kind === 'value_matches';
    needed.set(target, (needed.get(target) ?? false) || needsValue);
  }
  return [...needed].map(([target, needsValue]) => ({ target, needsValue }));
}

function describeCandidate(candidate: Candidate): string {
  switch (candidate.strategy) {
    case 'role':
      return `role ${candidate.role} ${JSON.stringify(candidate.name)}`;
    case 'label':
      return `label ${JSON.stringify(candidate.text)}`;
    case 'attribute':
      return `attribute ${candidate.name}=${JSON.stringify(candidate.value)}`;
    case 'text':
      return `text ${JSON.stringify(candidate.text)}`;
    case 'table_cell': {
      const role = candidate.role === undefined ? '' : ` ${candidate.role}`;
      return `table_cell${role} in column ${JSON.stringify(candidate.column)} where ${JSON.stringify(candidate.row.column)} = ${JSON.stringify(candidate.row.equals)}`;
    }
    default: {
      const unhandled: never = candidate;
      return String(unhandled);
    }
  }
}

// "role link "Member Lookup" matched 0, text "Member Lookup" matched 2"; candidates not tried are omitted.
export function describeCounts(candidates: readonly Candidate[], counts: readonly number[]): string {
  if (counts.length === 0) return 'no candidate could be tried';
  return counts.map((count, index) => `${describeCandidate(candidates[index])} matched ${String(count)}`).join(', ');
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function textVisible(observation: Observation, text: string, frame: string | undefined): boolean {
  const wanted = normalize(text);
  return observation.nodes
    .filter((node) => frame === undefined || node.frame === frame)
    .some((node) => [node.name, node.label, node.value].some((field) => field !== undefined && normalize(field).includes(wanted)));
}

function frameDescription(observation: Observation, frame: string | undefined): string {
  if (frame === undefined) return `the page (${observation.url})`;
  const url = observation.frames.find((candidate) => candidate.name === frame)?.url;
  return url === undefined ? `frame ${frame} (not present)` : `frame ${frame} (${url})`;
}

function unresolved(name: string, fact: TargetFact | undefined): string {
  if (fact === undefined) return `${name} was not looked up`;
  return `${name} did not resolve: ${describeCounts(fact.candidates, fact.counts)}`;
}

// Checkpoints and outcome detectors alike (RFC-002).
export function evaluatePredicate(predicate: Predicate, facts: Facts): PredicateResult {
  switch (predicate.kind) {
    case 'text_visible': {
      const where = frameDescription(facts.observation, predicate.frame);
      const holds = textVisible(facts.observation, predicate.text, predicate.frame);
      return {
        holds,
        expected: `text ${JSON.stringify(predicate.text)} visible in ${where}`,
        observed: holds ? 'text visible' : `text not visible in ${where}`,
      };
    }
    case 'target_visible': {
      const fact = facts.targets[predicate.target] as TargetFact | undefined;
      const holds = fact?.resolved === true;
      return {
        holds,
        expected: `${predicate.target} matches exactly one element`,
        observed: holds ? `${predicate.target} resolved` : unresolved(predicate.target, fact),
      };
    }
    case 'value_equals':
    case 'value_matches': {
      const fact = facts.targets[predicate.target] as TargetFact | undefined;
      const expected =
        predicate.kind === 'value_equals'
          ? `${predicate.target} value ${JSON.stringify(predicate.value)}`
          : `${predicate.target} value matching /${predicate.pattern}/`;
      if (fact?.resolved !== true || fact.value === undefined) {
        return { holds: false, expected, observed: unresolved(predicate.target, fact) };
      }
      const holds = predicate.kind === 'value_equals' ? fact.value === predicate.value : new RegExp(predicate.pattern).test(fact.value);
      return { holds, expected, observed: `value ${JSON.stringify(fact.value)}` };
    }
    default: {
      const unhandled: never = predicate;
      return unhandled;
    }
  }
}
