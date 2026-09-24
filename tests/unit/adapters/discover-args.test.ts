import { describe, expect, it } from 'vitest';
import { toDiscoverArgs } from '../../../src/adapters/discover-args';

describe('toDiscoverArgs', () => {
  it('builds the arguments from the CLI flags', () => {
    expect(toDiscoverArgs({ request: 'r.json', reasoner: 'hosted', target: 'http://localhost:9000', headed: true })).toEqual({
      ok: true,
      args: { requestPath: 'r.json', reasoner: 'hosted', targetUrl: 'http://localhost:9000/', headed: true },
    });
  });

  it('defaults to the local reasoner, the fixture and headless', () => {
    expect(toDiscoverArgs({ request: 'r.json' })).toEqual({
      ok: true,
      args: { requestPath: 'r.json', reasoner: 'local', targetUrl: 'http://localhost:8080/', headed: false },
    });
  });

  it('reports every problem at once', () => {
    const result = toDiscoverArgs({ reasoner: 'gpt', target: 'ftp://x' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toHaveLength(3);
  });
});
