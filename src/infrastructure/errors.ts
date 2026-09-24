// The first line of an error's message (Playwright appends a call log below it), or the thrown
// value as text.
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const end = error.message.indexOf('\n');
  return end === -1 ? error.message : error.message.slice(0, end);
}

// Thrown by broken code, never by a page or a system call.
export function isProgrammingError(error: unknown): boolean {
  return error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError || error instanceof SyntaxError;
}

// The errno code of a failed system call, e.g. ENOENT or EEXIST.
export function errnoCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

// At most max characters, the cut marked with an ellipsis.
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
