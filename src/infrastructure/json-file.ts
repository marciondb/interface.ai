import { readFile } from 'node:fs/promises';

// Rejects when the file is missing or is not JSON; the content itself is untrusted.
export async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
