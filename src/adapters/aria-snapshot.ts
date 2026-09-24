import type { Observation, ObservationNode } from '../models/observation';
import type { AriaElement, AriaNode, AriaSnapshotWire } from '../wire/in/aria-snapshot';

export type SnapshotAdaptation =
  | {
      readonly ok: true;
      readonly observation: Observation;
      // Observation ref (e7) -> raw surface ref (f1e13); opaque to everything but the driver.
      readonly refTargets: ReadonlyMap<string, string>;
    }
  | { readonly ok: false; readonly reason: string };

// Pure structure: their text is already carried by their cells and items.
const CONTAINER_ROLES = new Set(['table', 'rowgroup', 'row', 'list', 'iframe']);
// Form controls that may have no accessible name and then take a label from adjacent text.
const LABELLED_CONTROL_ROLES = new Set(['textbox', 'combobox', 'checkbox', 'radio', 'spinbutton', 'searchbox']);
// Roles whose own text is the current value, not a name.
const VALUE_ROLES = new Set(['textbox', 'combobox', 'spinbutton', 'searchbox']);
// Addressable even with no name; any other nameless element is skipped.
const ADDRESSABLE_ROLES = new Set([
  ...LABELLED_CONTROL_ROLES,
  'button',
  'link',
  'listbox',
  'option',
  'slider',
  'switch',
  'menuitem',
  'tab',
]);

function ownName(element: AriaElement): string {
  return element.name ?? (VALUE_ROLES.has(element.role) ? undefined : element.text) ?? '';
}

function visibleText(node: AriaNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  const text = typeof node === 'string' ? node : ownName(node);
  return text.trim() === '' ? undefined : text;
}

function toLabel(text: string | undefined): string | undefined {
  const label = text?.trim().replace(/:$/, '').trim();
  return label === undefined || label === '' ? undefined : label;
}

function countIframes(nodes: readonly AriaNode[]): number {
  return nodes.reduce(
    (count, node) =>
      typeof node === 'string' ? count : count + (node.role === 'iframe' ? 1 : 0) + countIframes(node.children ?? []),
    0,
  );
}

export function toObservation(raw: AriaSnapshotWire, observationId: number): SnapshotAdaptation {
  const iframes = countIframes(raw.nodes);
  if (iframes !== raw.frames.length) {
    return {
      ok: false,
      reason: `snapshot has ${String(iframes)} iframe(s) but the page reports ${String(raw.frames.length)} child frame(s)`,
    };
  }

  const nodes: ObservationNode[] = [];
  const refTargets = new Map<string, string>();
  let nextFrame = 0;

  function emit(element: AriaElement, frame: string | null, adjacentText: string | undefined): void {
    const name = ownName(element);
    if (name === '' && !ADDRESSABLE_ROLES.has(element.role)) return;

    const node: ObservationNode = { role: element.role, name, frame };
    if (element.ref !== undefined) {
      node.ref = `e${String(refTargets.size + 1)}`;
      refTargets.set(node.ref, element.ref);
    }
    const label = name === '' && LABELLED_CONTROL_ROLES.has(element.role) ? toLabel(adjacentText) : undefined;
    if (label !== undefined) node.label = label;
    if (VALUE_ROLES.has(element.role)) node.value = element.text ?? '';
    if (typeof element.checked === 'boolean') node.checked = element.checked;
    if (element.disabled !== undefined) node.disabled = element.disabled;
    nodes.push(node);
  }

  // parentPreviousText: text right before the parent, used when a control is first in its cell.
  function walk(
    children: readonly AriaNode[],
    frame: string | null,
    parent: AriaElement | undefined,
    parentPreviousText: string | undefined,
  ): void {
    children.forEach((child, index) => {
      const previousText = visibleText(children[index - 1]);
      if (typeof child === 'string') {
        if (child.trim() !== '') nodes.push({ role: 'text', name: child, frame });
        return;
      }
      if (child.role === 'iframe') {
        // Present: the iframe count was checked against raw.frames above.
        const childFrame = raw.frames[nextFrame];
        nextFrame += 1;
        walk(child.children ?? [], childFrame.name, child, undefined);
        return;
      }
      if (!CONTAINER_ROLES.has(child.role)) {
        const adjacent = index === 0 && parent?.role === 'cell' ? parentPreviousText : previousText;
        emit(child, frame, adjacent);
      }
      walk(child.children ?? [], frame, child, previousText);
    });
  }

  walk(raw.nodes, null, undefined, undefined);

  return {
    ok: true,
    observation: {
      observationId,
      url: raw.url,
      frames: [{ name: null, url: raw.url }, ...raw.frames],
      nodes,
      dialog: null,
    },
    refTargets,
  };
}
