import type { z } from 'zod';
import { OutcomeCatalogSchema, type OutcomeCatalog } from '../models/outcome-catalog';
import { OutcomeCatalogFileInSchema } from '../wire/in/outcome-catalog';

export type OutcomeCatalogResult = { ok: true; catalog: OutcomeCatalog } | { ok: false; issues: string[] };

export function fromOutcomeCatalogFile(raw: unknown): OutcomeCatalogResult {
  const envelope = OutcomeCatalogFileInSchema.safeParse(raw);
  if (!envelope.success) return { ok: false, issues: formatIssues(envelope.error) };
  const content: Record<string, unknown> = { ...envelope.data };
  delete content.schemaVersion;
  const parsed = OutcomeCatalogSchema.safeParse(content);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, catalog: parsed.data };
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.')}: ${issue.message}`);
}
