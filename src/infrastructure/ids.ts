import { randomUUID } from 'node:crypto';

// Unique id with a readable prefix, e.g. int-1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed.
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
