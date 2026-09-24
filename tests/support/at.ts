// items[index]; throws, failing the test, when there is no such item.
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at index ${String(index)} of ${String(items.length)}`);
  return item;
}
