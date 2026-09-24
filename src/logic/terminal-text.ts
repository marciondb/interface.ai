// ANSI escape sequences: CSI (colors, cursor moves), OSC (titles, links) and two-character forms.
const ESCAPE_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[0-~])/g;
// C0 and C1 control characters except newline.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

// Text from the model or the page, safe to print on the operator's terminal: it cannot move the
// cursor, rewrite earlier lines or change the terminal's state.
export function printable(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, '').replace(CONTROL, '');
}
