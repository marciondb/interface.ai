import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadCatalog, loadRequest } from '../../../../src/diplomat/store/discovery-inputs';
import { checkRequest } from '../../../../src/logic/capability-request';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const REQUEST = join(ROOT, 'discovery/requests/member.read-account-balance.json');
const SUB_ACCOUNT_REQUEST = join(ROOT, 'discovery/requests/member.open-sub-account.json');
const CATALOGS = join(ROOT, 'discovery/catalogs');

describe('committed discovery inputs', () => {
  it('loads the read-balance request and its catalog, and they agree', async () => {
    const request = await loadRequest(REQUEST);
    if (!request.ok) throw new Error(request.issues.join('; '));
    const catalog = await loadCatalog(CATALOGS, request.request.capability.app.product);
    if (!catalog.ok) throw new Error(catalog.issues.join('; '));

    expect(checkRequest(request.request, catalog.catalog)).toEqual([]);
    expect(request.request.capability).toMatchObject({ id: 'member.read-account-balance', version: '1.0.1' });
  });

  it('loads the sub-account request, whose validation outcomes quote the application verbatim', async () => {
    const request = await loadRequest(SUB_ACCOUNT_REQUEST);
    if (!request.ok) throw new Error(request.issues.join('; '));
    const catalog = await loadCatalog(CATALOGS, request.request.capability.app.product);
    if (!catalog.ok) throw new Error(catalog.issues.join('; '));
    const views = await readFile(join(ROOT, 'fixture/lib/views/subacct.js'), 'utf8');

    expect(checkRequest(request.request, catalog.catalog)).toEqual([]);
    expect(request.request.capability).toMatchObject({ id: 'member.open-sub-account', version: '1.0.0' });
    for (const id of ['invalid_initial_deposit', 'invalid_deposit_amount', 'invalid_nickname']) {
      const outcome = catalog.catalog.outcomes.find((declared) => declared.id === id);
      expect(outcome).toMatchObject({ kind: 'business', when: { kind: 'text_visible', frame: 'content' } });
      expect(views).toContain(`'${outcome?.when.kind === 'text_visible' ? outcome.when.text : ''}'`);
    }
  });

  it('reports a malformed request file with the offending field', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'discovery-inputs-'));
    const path = join(dir, 'bad.json');
    await writeFile(path, JSON.stringify({ schemaVersion: 1, goal: 'x' }), 'utf8');

    const result = await loadRequest(path);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.includes('capability'))).toBe(true);
  });

  it('refuses a product name that is not a plain catalog name', async () => {
    const result = await loadCatalog(CATALOGS, '../requests/member.read-account-balance');

    expect(result).toMatchObject({ ok: false });
  });
});
