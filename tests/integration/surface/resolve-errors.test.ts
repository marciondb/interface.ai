import type { Locator, Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { createRefRegistry } from '../../../src/diplomat/surface/ref-registry';
import { resolveTarget } from '../../../src/diplomat/surface/resolve';

// A page whose every locator counts with count().
function pageCounting(count: () => Promise<number>): Page {
  const locator = { count, getByText: () => locator, getByRole: () => locator, getByLabel: () => locator, locator: () => locator };
  return { locator: () => locator } as unknown as Page;
}

const TEXT = { candidates: [{ strategy: 'text' as const, text: 'Savings' }] };

describe('target resolution failures', () => {
  it('counts a frame that went away or is navigating as no match', async () => {
    for (const message of ['Frame was detached', 'Execution context was destroyed, most likely because of a navigation']) {
      const page = pageCounting(() => Promise.reject(new Error(message)));
      expect(await resolveTarget(page, TEXT, () => 'e1')).toEqual({ status: 'unresolved', counts: [0] });
    }
  });

  it('rejects with driver_error when counting fails for any other reason', async () => {
    const page = pageCounting(() => Promise.reject(new Error('Target page, context or browser has been closed')));

    const resolution = resolveTarget(page, TEXT, () => 'e1');

    await expect(resolution).rejects.toMatchObject({ name: 'SurfaceError', code: 'driver_error' });
    await expect(resolution).rejects.toThrow('has been closed');
  });
});

describe('ref registry', () => {
  const locator = {} as Locator;
  const page = { locator: (selector: string) => ({ selector }) } as unknown as Page;

  it('mints refs after the highest observed one, whatever the numbering', () => {
    const refs = createRefRegistry();
    refs.replace(new Map([['e3', 'f1e1'], ['e10', 'f1e7']]));

    expect(refs.mint(locator)).toBe('e11');
    expect(refs.mint(locator)).toBe('e12');
    expect(refs.locate(page, 'e10')).toEqual({ selector: 'aria-ref=f1e7' });
    expect(refs.locate(page, 'e12')).toBe(locator);
  });

  it('forgets minted refs at the next observation', () => {
    const refs = createRefRegistry();
    refs.replace(new Map());
    const minted = refs.mint(locator);
    refs.replace(new Map([['e1', 'f1e1']]));

    expect(minted).toBe('e1');
    expect(refs.locate(page, 'e1')).toEqual({ selector: 'aria-ref=f1e1' });
    expect(() => refs.locate(page, 'e2')).toThrow(expect.objectContaining({ code: 'unknown_ref' }));
  });
});
