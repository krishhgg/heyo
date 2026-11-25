// Serves e2e/fixtures over HTTP. Content scripts do not run on file URLs by default.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Starts the fixture server. Port 0 picks a free port. `root` is the folder it
 * serves, the fixtures unless given. Resolves with the server and its port.
 */
export function startFixtureServer(port = 0, root = fixtures) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    readFile(join(root, path)).then(
      (body) => {
        res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
        res.end(body);
      },
      () => {
        res.writeHead(404);
        res.end('not found');
      },
    );
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startFixtureServer(Number(process.argv[2] ?? 0));
  console.log(`fixtures on http://127.0.0.1:${port}`);
}
