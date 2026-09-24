import { randomUUID } from 'node:crypto';

// Unique id with a readable prefix, e.g. int-1b9d6bcdbbfd4b2d9b5dab8dfbbd4bed. One unbroken hex
// token, so evidence redaction never mistakes part of it for an account number.
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll('-', '')}`;
}
