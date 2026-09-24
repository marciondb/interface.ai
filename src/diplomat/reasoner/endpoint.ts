const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function parseBaseUrl(text: string, variable: string): URL {
  try {
    return new URL(text);
  } catch {
    throw new Error(`${variable} is not a valid URL: ${text}`);
  }
}

export function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname);
}
