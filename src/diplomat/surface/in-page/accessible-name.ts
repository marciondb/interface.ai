// Scripts here run inside the page: no closures, no imports, and no nested named functions
// (they do not survive serialization). The project compiles without DOM types, so each declares
// the few DOM members it reads.

type TextNode = { readonly textContent: string | null };

export type NamedElement = {
  readonly tagName: string;
  readonly textContent: string | null;
  readonly ownerDocument: { getElementById(id: string): TextNode | null };
  readonly value?: string;
  readonly labels?: ArrayLike<TextNode> | null;
  getAttribute(name: string): string | null;
  querySelectorAll(selectors: string): ArrayLike<{ getAttribute(name: string): string | null }>;
};

export type AccessibleText = {
  // Explicit or implicit ARIA role; '' when the element has neither.
  readonly role: string;
  // The first non-empty of texts, skipping a field's own content (a value, not a name).
  readonly name: string;
  // What a `label` locator matches (Playwright getByLabel): native label, aria-labelledby or
  // aria-label text; '' when there is none.
  readonly label: string;
  // Every text a person may read as the control's label, in accessible-name order.
  readonly texts: readonly string[];
};

// The one role and name computation shared by describe (policy), inspect (synthesis) and the
// human capture script, so all three agree on what an element is called.
export function accessibleText(element: NamedElement): AccessibleText {
  const tag = element.tagName.toLowerCase();
  const type = (element.getAttribute('type') ?? 'text').toLowerCase();
  const buttonLike = tag === 'button' || (tag === 'input' && ['submit', 'button', 'reset', 'image'].includes(type));
  const field = ['input', 'select', 'textarea'].includes(tag) && !buttonLike;
  const implicit: Record<string, string> = { a: 'link', select: 'combobox', textarea: 'textbox', td: 'cell', th: 'columnheader' };
  const role =
    element.getAttribute('role') ||
    (buttonLike ? 'button' : tag === 'input' ? (['checkbox', 'radio'].includes(type) ? type : 'textbox') : (implicit[tag] ?? ''));
  const ownerDocument = element.ownerDocument;
  const labelledBy = (element.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .map((id) => (id === '' ? '' : (ownerDocument.getElementById(id)?.textContent ?? '')))
    .join(' ');
  const ariaLabel = element.getAttribute('aria-label') ?? '';
  const nativeLabels = Array.from(element.labels ?? [], (label) => label.textContent ?? '').join(' ');
  const content = buttonLike && tag === 'input' ? (element.value ?? '') : (element.textContent ?? '');
  const sources: [string, boolean][] = [
    [ariaLabel, true],
    [labelledBy, true],
    [content, !field],
    [element.getAttribute('alt') ?? '', true],
    [Array.from(element.querySelectorAll('img[alt]'), (image) => image.getAttribute('alt') ?? '').join(' '), true],
    [nativeLabels, true],
    [element.getAttribute('title') ?? '', true],
  ];
  const normalized = sources
    .map(([text, naming]): [string, boolean] => [text.replace(/\s+/g, ' ').trim().slice(0, 200), naming])
    .filter(([text]) => text !== '');
  const label = [nativeLabels, labelledBy, ariaLabel].map((text) => text.replace(/\s+/g, ' ').trim()).find((text) => text !== '') ?? '';
  return {
    role,
    name: normalized.find(([, naming]) => naming)?.[0] ?? '',
    label,
    texts: normalized.map(([text]) => text),
  };
}

// A page function for Locator.evaluate that calls fn with the element and accessibleText.
// Playwright ships a page function as String(fn), so this one stands in for the composed source;
// called in Node, it throws.
export function withAccessibleText<E, R>(fn: (element: E, accessible: typeof accessibleText) => R): (element: E) => R {
  const source = `(element) => (${fn.toString()})(element, ${accessibleText.toString()})`;
  const pageFunction = (): R => {
    throw new Error('runs only inside the page');
  };
  pageFunction.toString = () => source;
  return pageFunction;
}
