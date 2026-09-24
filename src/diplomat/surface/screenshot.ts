import type { Locator, Page } from 'playwright';
import { escapeRegExp } from '../../logic/regexp';
import { isDetachedFrameError } from './playwright-errors';

export const MASK_COLOR = '#FF00FF';

type FieldElement = {
  readonly tagName: string;
  readonly value?: string;
  readonly selectedOptions?: ArrayLike<{ readonly text: string }>;
};

// Runs inside the page: indices of the fields whose value (a list: its chosen option text)
// contains a needle.
function fieldsShowing(fields: readonly FieldElement[], needles: readonly string[]): number[] {
  return fields.flatMap((field, index) => {
    const shown =
      field.tagName.toLowerCase() === 'select'
        ? Array.from(field.selectedOptions ?? [], (option) => option.text).join(' ')
        : (field.value ?? '');
    return needles.some((needle) => shown.includes(needle)) ? [index] : [];
  });
}

// The elements, in every frame, showing one of texts: the innermost element whose visible text
// contains it (whitespace collapsed, as Playwright matches text) and every field whose value does.
export async function maskLocators(page: Page, texts: readonly string[]): Promise<Locator[]> {
  const needles = [...new Set(texts.filter((text) => text !== ''))];
  if (needles.length === 0) return [];
  const textPatterns = needles
    .map((needle) => needle.replace(/\s+/g, ' ').trim())
    .filter((needle) => needle !== '')
    .map((needle) => new RegExp(escapeRegExp(needle)));
  const masks: Locator[] = [];
  for (const frame of page.frames()) {
    const fields = frame.locator('input, textarea, select');
    let showing: number[];
    try {
      showing = await fields.evaluateAll(fieldsShowing, needles);
    } catch (error) {
      // A frame that went away is not in the screenshot either.
      if (isDetachedFrameError(error)) continue;
      throw error;
    }
    masks.push(...textPatterns.map((pattern) => frame.getByText(pattern)), ...showing.map((index) => fields.nth(index)));
  }
  return masks;
}

export async function takeScreenshot(page: Page, maskTexts: readonly string[], timeout: number): Promise<Uint8Array> {
  const mask = await maskLocators(page, maskTexts);
  return page.screenshot({ fullPage: true, timeout, ...(mask.length === 0 ? {} : { mask, maskColor: MASK_COLOR }) });
}
