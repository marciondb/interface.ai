import type { z } from 'zod';
import { CapabilityRequestSchema, type CapabilityRequest } from '../models/capability-request';
import { CapabilityRequestFileInSchema } from '../wire/in/capability-request';

export type CapabilityRequestResult = { ok: true; request: CapabilityRequest } | { ok: false; issues: string[] };

export function fromCapabilityRequestFile(raw: unknown): CapabilityRequestResult {
  const envelope = CapabilityRequestFileInSchema.safeParse(raw);
  if (!envelope.success) return { ok: false, issues: formatIssues(envelope.error) };
  const content: Record<string, unknown> = { ...envelope.data };
  delete content.schemaVersion;
  const parsed = CapabilityRequestSchema.safeParse(content);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, request: parsed.data };
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.')}: ${issue.message}`);
}
