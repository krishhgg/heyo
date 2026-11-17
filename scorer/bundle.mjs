// Bundles TypeScript entry points with esbuild so Node can run them.
import { build } from 'esbuild';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));

let cache;

/** A fresh folder for this process's bundles. */
export async function cacheDir() {
  // The real path, with no symlinks in it. The decision worker may read only
  // its own bundle, and Node would otherwise need to read a symlink on the way.
  cache ??= await mkdtemp(join(await realpath(tmpdir()), 'heyo-scorer-'));
  return cache;
}

/**
 * Bundles one entry into a single ES module and returns its path.
 * `plugins` are esbuild plugins, used to redirect imports.
 */
export async function bundle(entry, name, plugins = []) {
  const outfile = join(await cacheDir(), `${name}.mjs`);
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'warning',
    plugins,
  });
  return outfile;
}

/**
 * An esbuild plugin for bundling a decision from any folder. It points the
 * worker's `heyo-decision` import at that folder, and it resolves the
 * decision's `../core/...` imports to this repo's own core, so a copied or
 * edited core beside the decision is never used.
 */
export function decisionPlugin(decisionDir) {
  return {
    name: 'heyo-decision',
    setup(esbuild) {
      esbuild.onResolve({ filter: /^heyo-decision$/ }, () => ({
        path: join(decisionDir, 'index.ts'),
      }));
      esbuild.onResolve({ filter: /^\.\.\/core\// }, (args) =>
        args.importer.startsWith(decisionDir)
          ? { path: join(root, 'src/core', `${basename(args.path).replace(/\.ts$/, '')}.ts`) }
          : undefined,
      );
    },
  };
}
