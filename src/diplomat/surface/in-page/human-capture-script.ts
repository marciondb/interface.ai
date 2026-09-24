import { HUMAN_INPUT_MASK } from '../../../models/intervention';
import { accessibleText } from './accessible-name';

// Name of the binding the page script reports to.
export const HUMAN_EVENT_BINDING = '__cuHumanEvent';

// Installed in every document of the context (frames included). It reports trusted clicks and
// changed fields with a description of the element; a field's value never leaves the page.
// The driver ignores reports outside a human capture, so automation's own actions never count.
export const HUMAN_CAPTURE_SCRIPT = `(() => {
  if (window.__cuHumanCapture) return;
  window.__cuHumanCapture = true;
  const accessibleText = ${accessibleText.toString()};
  const send = (payload) => {
    const binding = window.${HUMAN_EVENT_BINDING};
    if (typeof binding === 'function') binding(payload).catch(() => undefined);
  };
  const describe = (element) => {
    const { role, name } = accessibleText(element);
    const target = { tag: element.tagName.toLowerCase() };
    if (role) target.role = role;
    if (name) target.name = name.slice(0, 60);
    if (element.id) target.id = element.id;
    const nameAttr = element.getAttribute('name');
    if (nameAttr) target.nameAttr = nameAttr;
    return target;
  };
  document.addEventListener('click', (event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const element = event.target.closest('a, button, input, select, textarea, [role]') || event.target;
    send({ kind: 'click', target: describe(element) });
  }, true);
  document.addEventListener('change', (event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    send({ kind: 'input', target: describe(event.target), value: ${JSON.stringify(HUMAN_INPUT_MASK)} });
  }, true);
})();`;
