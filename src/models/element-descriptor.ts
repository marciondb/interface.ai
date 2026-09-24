// What the surface knows about an element beyond its observation node (role, name, frame);
// discovery turns it into locator candidates (ADR-008). Texts are whitespace-normalized.
export type ElementDescriptor = {
  // Stable identifying attributes (web: name, id).
  readonly attributes: { readonly name?: string; readonly id?: string };
  // For a value control: the text of the cell before its own in the same table row, as displayed ("Member ID:").
  readonly label?: string;
  // For an element in a table row below the header row: its column's header, and each
  // header's cell text in that row.
  readonly cell?: { readonly column: string; readonly row: Readonly<Record<string, string>> };
};
