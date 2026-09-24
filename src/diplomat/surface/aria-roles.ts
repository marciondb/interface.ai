import type { Locator } from 'playwright';

export type AriaRole = Parameters<Locator['getByRole']>[0];

// The roles Playwright's getByRole accepts; a Record, so the compiler flags a role Playwright
// adds or drops.
const ARIA_ROLES: Readonly<Record<AriaRole, true>> = {
  alert: true, alertdialog: true, application: true, article: true, banner: true, blockquote: true, button: true,
  caption: true, cell: true, checkbox: true, code: true, columnheader: true, combobox: true, complementary: true,
  contentinfo: true, definition: true, deletion: true, dialog: true, directory: true, document: true, emphasis: true,
  feed: true, figure: true, form: true, generic: true, grid: true, gridcell: true, group: true, heading: true, img: true,
  insertion: true, link: true, list: true, listbox: true, listitem: true, log: true, main: true, marquee: true,
  math: true, meter: true, menu: true, menubar: true, menuitem: true, menuitemcheckbox: true, menuitemradio: true,
  navigation: true, none: true, note: true, option: true, paragraph: true, presentation: true, progressbar: true,
  radio: true, radiogroup: true, region: true, row: true, rowgroup: true, rowheader: true, scrollbar: true, search: true,
  searchbox: true, separator: true, slider: true, spinbutton: true, status: true, strong: true, subscript: true,
  superscript: true, switch: true, tab: true, table: true, tablist: true, tabpanel: true, term: true, textbox: true,
  time: true, timer: true, toolbar: true, tooltip: true, tree: true, treegrid: true, treeitem: true,
};

export function isAriaRole(role: string): role is AriaRole {
  return Object.hasOwn(ARIA_ROLES, role);
}
