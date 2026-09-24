import type { Locator, Page } from 'playwright';
import type { Candidate } from '../../models/capability';
import { isAriaRole, type AriaRole } from './aria-roles';
import { SurfaceError } from './errors';

const ATTRIBUTE_NAME = /^[a-zA-Z_][-a-zA-Z0-9_:.]*$/;
// Controls that take a value; excludes buttons and hidden fields that share a row with the label.
const IS_VALUE_CONTROL =
  'self::input[not(@type="hidden" or @type="submit" or @type="button" or @type="image" or @type="reset")] or self::select or self::textarea';
const VALUE_CONTROL = `*[${IS_VALUE_CONTROL}]`;

function cssString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// XPath 1.0 has no escapes: split on double quotes and concat().
function xpathString(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value
    .split('"')
    .map((part) => `"${part}"`)
    .join(`, '"', `)})`;
}

// 1-based position of the header cell with this text in the first row of the cell's table.
function columnPosition(header: string): string {
  return `count(ancestor::table[1]/descendant::tr[1]/*[normalize-space(.)=${xpathString(header)}]/preceding-sibling::*) + 1`;
}

function hasHeader(header: string): string {
  return `ancestor::table[1]/descendant::tr[1]/*[normalize-space(.)=${xpathString(header)}]`;
}

function ariaRole(role: string): AriaRole {
  if (!isAriaRole(role)) throw new SurfaceError('invalid_candidate', `role "${role}" is not an ARIA role`);
  return role;
}

export function scopeOf(page: Page, frame: string | undefined): Locator {
  return frame === undefined ? page.locator(':root') : page.frameLocator(`iframe[name=${cssString(frame)}]`).locator(':root');
}

// Where a candidate may match, in order: the first alternative that matches anything is the
// candidate's match. Empty when the candidate cannot be expressed as a locator (it then counts
// as zero matches). Rejects with invalid_candidate for a role Playwright does not know.
export function candidateLocators(scope: Locator, candidate: Candidate): readonly Locator[] {
  switch (candidate.strategy) {
    case 'role':
      return [scope.getByRole(ariaRole(candidate.role), { name: candidate.name, exact: true })];
    case 'label':
      return [
        // Associated by <label>, aria-labelledby or aria-label.
        scope.getByLabel(candidate.text, { exact: true }),
        // Table layouts with no association: in the cell right after the one whose text is
        // exactly the label, its value control, or the cell itself when it holds none (a
        // displayed value).
        scope.locator(
          `xpath=//td[normalize-space(.)=${xpathString(candidate.text)}]/following-sibling::td[1]` +
            `/descendant-or-self::*[${IS_VALUE_CONTROL} or (self::td and not(.//${VALUE_CONTROL}))]`,
        ),
      ];
    case 'attribute':
      if (!ATTRIBUTE_NAME.test(candidate.name)) return [];
      return [scope.locator(`[${candidate.name}=${cssString(candidate.value)}]`)];
    case 'text':
      return [scope.getByText(candidate.text, { exact: true })];
    case 'table_cell': {
      const { row, column } = candidate;
      const cell = scope.locator(
        `xpath=//tr[${hasHeader(row.column)} and ${hasHeader(column)}]` +
          `[*[position() = ${columnPosition(row.column)}][normalize-space(.)=${xpathString(row.equals)}]]` +
          `/*[position() = ${columnPosition(column)}]`,
      );
      return [candidate.role === undefined ? cell : cell.getByRole(ariaRole(candidate.role))];
    }
    default: {
      const unhandled: never = candidate;
      return unhandled;
    }
  }
}
