import { VERBS, type Verb } from '../models/action';
import type { Observation, ObservationNode } from '../models/observation';

// Generic on purpose: no app, flow, or domain. The same prompt drives every discovery.
const VERB_HELP: Record<Verb, string> = {
  click: 'click the element `target`; argument is null.',
  fill: 'type `argument` into the text field `target`, replacing its value.',
  select: 'choose the option labelled `argument` in the list `target`.',
  press: 'press the key `argument` (for example Enter) on `target`, or on the focused element when target is null.',
  navigate: 'open the URL `argument`; target is null.',
  read: 'capture the visible text of `target` as the output named `argument`.',
  finish: 'the goal is complete; argument is an optional one-line summary; target is null.',
  request_help: 'you are stuck or the goal needs a person; `argument` says why; target is null.',
};

export const SYSTEM_PROMPT = [
  'You operate a user interface on behalf of a human operator.',
  'Each turn you receive the goal and the current screen, one element per line.',
  'Lines that start with a ref such as e7 are elements you can act on; indented lines are text shown for context only.',
  'Answer with exactly one JSON object with the fields verb, target, argument and rationale.',
  'Use null for a field the verb does not take. rationale is one short sentence.',
  '',
  'Verbs:',
  ...VERBS.map((verb) => `- ${verb}: ${VERB_HELP[verb]}`),
  '',
  'Rules:',
  '- Only use refs listed on the current screen.',
  '- Use read once for each value the goal asks for, with the output name the goal uses.',
  '- Answer finish only when the goal is complete and every requested value has been read.',
  '- Answer request_help when you cannot make progress.',
  '- A "Feedback:" line means your previous action did not make progress; choose a different action.',
  '- A "Previous answer rejected:" line explains why your last answer was invalid; answer again without that mistake.',
].join('\n');

export type UserPromptInput = {
  readonly goal: string;
  readonly observation: Observation;
  readonly feedback?: string;
  readonly repair?: string;
};

function quote(text: string): string {
  return JSON.stringify(text);
}

function nodeLine(node: ObservationNode): string {
  if (node.ref === undefined) return `  ${node.role} ${quote(node.name)}`;
  const parts = [node.ref, node.role];
  if (node.name !== '') parts.push(quote(node.name));
  if (node.label !== undefined) parts.push(`label=${quote(node.label)}`);
  if (node.value !== undefined) parts.push(`value=${quote(node.value)}`);
  if (node.checked !== undefined) parts.push(`checked=${String(node.checked)}`);
  if (node.disabled === true) parts.push('disabled');
  return parts.join(' ');
}

function frameHeader(name: string | null, url: string | undefined): string {
  const label = name === null ? 'page' : `frame ${name}`;
  return url === undefined ? `[${label}]` : `[${label} ${url}]`;
}

function screenLines(observation: Observation): string[] {
  const names = [...new Set([...observation.frames.map((frame) => frame.name), ...observation.nodes.map((node) => node.frame)])];
  return names.flatMap((name) => [
    frameHeader(name, observation.frames.find((frame) => frame.name === name)?.url),
    ...observation.nodes.filter((node) => node.frame === name).map(nodeLine),
  ]);
}

export function buildUserPrompt({ goal, observation, feedback, repair }: UserPromptInput): string {
  const lines = [`Goal: ${goal}`, '', ...screenLines(observation)];
  if (observation.dialog !== null) lines.push(`[dialog ${observation.dialog.type}] ${quote(observation.dialog.message)}`);
  if (feedback !== undefined) lines.push('', `Feedback: ${feedback}`);
  if (repair !== undefined) lines.push('', `Previous answer rejected: ${repair}`);
  return lines.join('\n');
}
