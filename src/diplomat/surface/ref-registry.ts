import type { Locator, Page } from 'playwright';
import { SurfaceError } from './errors';

const REF_NUMBER = /^e([0-9]+)$/;

export type RefRegistry = {
  // Replaces every ref with those of a new observation (ref -> Playwright aria-ref).
  replace(observed: ReadonlyMap<string, string>): void;
  // A fresh ref for a resolved target, valid until the next replace() or clear().
  mint(locator: Locator): string;
  // Only checks the ref is known; that it belongs to the current observation is the
  // controller's Ground step.
  locate(page: Page, ref: string): Locator;
  clear(): void;
};

export function createRefRegistry(): RefRegistry {
  let observed: ReadonlyMap<string, string> = new Map();
  let resolved = new Map<string, Locator>();
  let next = 1;

  function after(refs: Iterable<string>): number {
    let highest = 0;
    for (const ref of refs) highest = Math.max(highest, Number(REF_NUMBER.exec(ref)?.[1] ?? 0));
    return highest + 1;
  }

  return {
    replace(refs) {
      observed = refs;
      resolved = new Map();
      next = after(refs.keys());
    },

    mint(locator) {
      const ref = `e${String(next)}`;
      next += 1;
      resolved.set(ref, locator);
      return ref;
    },

    locate(page, ref) {
      const raw = observed.get(ref);
      if (raw !== undefined) return page.locator(`aria-ref=${raw}`);
      const target = resolved.get(ref);
      if (target !== undefined) return target;
      throw new SurfaceError('unknown_ref', `${ref} is not in the latest observation`);
    },

    clear() {
      observed = new Map();
      resolved = new Map();
      next = 1;
    },
  };
}
