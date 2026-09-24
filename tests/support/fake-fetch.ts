export type FetchCall = {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Answers each call with the next queued item; an Error is thrown as a network failure.
export function fakeFetch(queue: readonly (Response | Error)[]) {
  const pending = [...queue];
  const calls: FetchCall[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body });
    const next = pending.shift();
    if (next === undefined) return Promise.reject(new Error('fakeFetch: no response queued'));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  };
  return { fetch, calls };
}
