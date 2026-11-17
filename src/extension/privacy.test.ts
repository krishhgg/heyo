// The extension promises to make no network calls and to keep its log on the device.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('..', import.meta.url));

const NETWORK_APIS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
  /\bsendBeacon\b/,
  /\bimportScripts\b/,
  /\bWebTransport\b/,
  /\bRTCPeerConnection\b/,
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
    .map((e) => join(e.parentPath, e.name));
}

describe('privacy', () => {
  it('ships no code that can make a network call', () => {
    const shipped = ['extension', 'core', 'decision'].flatMap((dir) => sources(join(src, dir)));
    expect(shipped.length).toBeGreaterThan(10);
    for (const file of shipped) {
      const code = readFileSync(file, 'utf8');
      for (const api of NETWORK_APIS) {
        expect(api.test(code), `${file} uses ${api.source}`).toBe(false);
      }
    }
  });

  it('asks for no permission beyond its own storage and running its scripts on pages', () => {
    const manifest = JSON.parse(
      readFileSync(join(src, 'extension/manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest.permissions ?? []).toEqual(['storage']);
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(manifest.externally_connectable).toBeUndefined();
  });
});
