import type { ElementDescriptor } from '../../../models/element-descriptor';
import { withAccessibleText, type accessibleText, type NamedElement } from './accessible-name';

type InspectedElement = NamedElement & {
  readonly parentElement: InspectedElement | null;
  readonly previousElementSibling: InspectedElement | null;
  readonly cellIndex?: number;
  readonly cells?: ArrayLike<InspectedElement>;
  readonly rows?: ArrayLike<InspectedElement>;
  closest(selectors: string): InspectedElement | null;
  querySelector(selectors: string): InspectedElement | null;
};

// Runs inside the page (see accessible-name.ts). The label and header rules mirror the `label`
// and `table_cell` locators, so what is described here can be located again: a value control's
// own label when it has one, else the text of the table cell before its own.
function elementDescriptor(element: InspectedElement, accessible: typeof accessibleText): ElementDescriptor {
  const attributes: { name?: string; id?: string } = {};
  const nameAttribute = element.getAttribute('name');
  if (nameAttribute !== null && nameAttribute !== '') attributes.name = nameAttribute;
  const idAttribute = element.getAttribute('id');
  if (idAttribute !== null && idAttribute !== '') attributes.id = idAttribute;

  const tag = element.tagName.toLowerCase();
  const type = (element.getAttribute('type') ?? 'text').toLowerCase();
  const valueControl =
    tag === 'select' || tag === 'textarea' || (tag === 'input' && !['hidden', 'submit', 'button', 'image', 'reset'].includes(type));
  const ownLabel = valueControl ? accessible(element).label : '';

  const cell = element.closest('td, th');
  const row = cell?.parentElement ?? null;
  const table = row?.closest('table') ?? null;
  if (cell === null || row === null || table === null) return { attributes, ...(ownLabel === '' ? {} : { label: ownLabel }) };

  const valueCell = tag === 'td' && element.querySelector('input, select, textarea, a, button') === null;
  const adjacentLabel =
    valueControl || valueCell ? (cell.previousElementSibling?.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
  const label = ownLabel === '' ? adjacentLabel : ownLabel;

  let position: { column: string; row: Record<string, string> } | undefined;
  const header = table.rows?.[0];
  if (header !== undefined && header !== row && cell.cellIndex !== undefined) {
    const headers = Array.from(header.cells ?? [], (headerCell) => (headerCell.textContent ?? '').replace(/\s+/g, ' ').trim());
    const column = headers[cell.cellIndex] ?? '';
    if (column !== '') {
      const texts: Record<string, string> = {};
      Array.from(row.cells ?? []).forEach((rowCell, index) => {
        const heading = headers[index] ?? '';
        if (heading !== '') texts[heading] = (rowCell.textContent ?? '').replace(/\s+/g, ' ').trim();
      });
      position = { column, row: texts };
    }
  }
  return { attributes, ...(label === '' ? {} : { label }), ...(position === undefined ? {} : { cell: position }) };
}

export const ELEMENT_DESCRIPTOR_SCRIPT = withAccessibleText(elementDescriptor);
