import { once } from 'node:events';
import { createServer } from 'node:http';

export type StaticSite = {
  readonly baseUrl: string;
  stop(): Promise<void>;
};

// Serves fixed HTML pages by path on an ephemeral port, for driver tests that need a page
// shape the fixture does not have.
export async function serveStatic(pages: Readonly<Record<string, string>>): Promise<StaticSite> {
  const server = createServer((request, response) => {
    const page = pages[new URL(request.url ?? '/', 'http://localhost').pathname];
    response.writeHead(page === undefined ? 404 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(page ?? 'not found');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    async stop() {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}
