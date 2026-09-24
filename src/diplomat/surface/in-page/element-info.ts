import type { ElementInfo } from '../../../models/resolution';
import { withAccessibleText, type accessibleText, type NamedElement } from './accessible-name';

type LinkOrControl = NamedElement & {
  readonly ownerDocument: { readonly location: { readonly href: string } };
  readonly href?: string;
  readonly formAction?: string;
  readonly form?: { readonly action: string } | null;
};

// Runs inside the page (see accessible-name.ts): what the gateway judges an action on.
function elementInfo(element: LinkOrControl, accessible: typeof accessibleText): ElementInfo {
  const tag = element.tagName.toLowerCase();
  const type = (element.getAttribute('type') ?? 'text').toLowerCase();
  const buttonLike = tag === 'button' || (tag === 'input' && ['submit', 'button', 'reset', 'image'].includes(type));
  const { role, name, texts } = accessible(element);
  let destination: string | undefined;
  if (tag === 'a' && element.getAttribute('href') !== null) destination = element.href;
  else if (buttonLike && type !== 'reset' && type !== 'button' && element.form) {
    destination = element.getAttribute('formaction') === null ? element.form.action : element.formAction;
  }
  const info: ElementInfo = { role: role || tag, name, texts, frameUrl: element.ownerDocument.location.href };
  return destination === undefined ? info : { ...info, destination };
}

export const ELEMENT_INFO_SCRIPT = withAccessibleText(elementInfo);
