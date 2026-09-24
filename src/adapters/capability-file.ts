import type { z } from 'zod';
import { CapabilitySchema, type Capability } from '../models/capability';
import { CapabilityFileInSchema } from '../wire/in/capability-file';
import type { CapabilityFileOut } from '../wire/out/capability-file';

export type CapabilityFileResult = { ok: true; capability: Capability } | { ok: false; issues: string[] };

export function fromCapabilityFile(raw: unknown): CapabilityFileResult {
  const envelope = CapabilityFileInSchema.safeParse(raw);
  if (!envelope.success) return { ok: false, issues: formatIssues(envelope.error) };
  const sections: Record<string, unknown> = { ...envelope.data };
  delete sections.schemaVersion;
  const parsed = CapabilitySchema.safeParse(sections);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, capability: parsed.data };
}

export function toCapabilityFile(capability: Capability): CapabilityFileOut {
  const file: CapabilityFileOut = {
    schemaVersion: 1,
    capability: capability.capability,
    preconditions: capability.preconditions,
    inputs: capability.inputs,
    outputs: capability.outputs,
    targets: capability.targets,
    steps: capability.steps,
    outcomes: capability.outcomes,
    provenance: capability.provenance,
  };
  if (capability.notes !== undefined) file.notes = capability.notes;
  return file;
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.')}: ${issue.message}`);
}
