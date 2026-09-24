import { join } from 'node:path';
import { fromCapabilityRequestFile, type CapabilityRequestResult } from '../../adapters/capability-request';
import { fromOutcomeCatalogFile, type OutcomeCatalogResult } from '../../adapters/outcome-catalog';
import { readJsonFile } from '../../infrastructure/json-file';

const PRODUCT = /^[a-z0-9][a-z0-9-]*$/;

function readError(path: string, error: unknown): { ok: false; issues: string[] } {
  return { ok: false, issues: [`${path}: ${error instanceof Error ? error.message : String(error)}`] };
}

export async function loadRequest(path: string): Promise<CapabilityRequestResult> {
  let raw: unknown;
  try {
    raw = await readJsonFile(path);
  } catch (error) {
    return readError(path, error);
  }
  const result = fromCapabilityRequestFile(raw);
  return result.ok ? result : { ok: false, issues: result.issues.map((issue) => `${path}: ${issue}`) };
}

// <catalogsDir>/<product>.json
export async function loadCatalog(catalogsDir: string, product: string): Promise<OutcomeCatalogResult> {
  if (!PRODUCT.test(product)) return { ok: false, issues: [`product ${JSON.stringify(product)} is not a catalog name`] };
  const path = join(catalogsDir, `${product}.json`);
  let raw: unknown;
  try {
    raw = await readJsonFile(path);
  } catch (error) {
    return readError(path, error);
  }
  const result = fromOutcomeCatalogFile(raw);
  return result.ok ? result : { ok: false, issues: result.issues.map((issue) => `${path}: ${issue}`) };
}
