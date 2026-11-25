// Types for server.mjs, which Node runs as plain JavaScript.
import type { Server } from 'node:http';

export function startFixtureServer(
  port?: number,
  root?: string,
): Promise<{ server: Server; port: number }>;
