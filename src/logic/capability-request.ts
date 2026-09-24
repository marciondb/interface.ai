import { GOAL_PARAMETER, type CapabilityRequest } from '../models/capability-request';
import type { OutcomeCatalog } from '../models/outcome-catalog';
import { checkValue } from './capability-inputs';

function goalParameters(goal: string): string[] {
  return [...goal.matchAll(GOAL_PARAMETER)].map(([, name]) => name);
}

// The goal the model sees: the template with each input's example, plus which outputs are
// read already. The model is stateless (RFC-003), so this is how it learns a read happened.
export function renderGoal(request: CapabilityRequest, read: readonly string[] = []): string {
  const goal = request.goal.replace(GOAL_PARAMETER, (placeholder, name: string) =>
    Object.hasOwn(request.inputs, name) ? request.inputs[name].example : placeholder,
  );
  const outputs = Object.keys(request.outputs);
  const done = outputs.filter((name) => read.includes(name));
  const left = outputs.filter((name) => !read.includes(name));
  if (done.length === 0) return `${goal} (outputs to read: ${left.join(', ')})`;
  return `${goal} (already read: ${done.join(', ')}; ${left.length === 0 ? 'nothing left to read' : `still to read: ${left.join(', ')}`})`;
}

// Why the request cannot drive a discovery; empty when it can. Examples are how inputs are
// recognised in the trace, so each must be valid, distinct and named in the goal.
export function checkRequest(request: CapabilityRequest, catalog: OutcomeCatalog): string[] {
  const issues: string[] = [];
  const parameters = goalParameters(request.goal);
  for (const name of new Set(parameters)) {
    if (!Object.hasOwn(request.inputs, name)) issues.push(`goal: {{${name}}} is not a declared input`);
  }
  const seen = new Map<string, string>();
  for (const [name, input] of Object.entries(request.inputs)) {
    if (!parameters.includes(name)) issues.push(`inputs.${name}: not used in the goal`);
    const error = checkValue(input, input.example);
    if (error !== undefined) issues.push(`inputs.${name}.example: ${error.message}`);
    const other = seen.get(input.example);
    if (other !== undefined) issues.push(`inputs.${name}.example: same as inputs.${other}.example`);
    seen.set(input.example, name);
  }
  if (catalog.product !== request.capability.app.product) {
    issues.push(`catalog: describes ${catalog.product}, the request targets ${request.capability.app.product}`);
  }
  const known = new Set(catalog.outcomes.map((outcome) => outcome.id));
  for (const id of request.outcomes) {
    if (!known.has(id)) issues.push(`outcomes: ${id} is not in the ${catalog.product} catalog`);
  }
  return issues;
}
