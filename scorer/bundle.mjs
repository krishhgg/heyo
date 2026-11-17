// Bundles TypeScript entry points with esbuild so Node can run them.
import { build } from 'esbuild';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
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
 *
 * It also refuses every other import a decision makes. The bundler runs
 * outside the locked-down process, so an import of a log file, a Node module
 * or anything else outside the decision's folder would be read here and carried
 * into the bundle, review marks and all.
 */
export function decisionPlugin(decisionDir) {
  const folder = realpathSync(decisionDir);
  const inFolder = (path) => path.startsWith(folder + sep);
  return {
    name: 'heyo-decision',
    setup(esbuild) {
      esbuild.onResolve({ filter: /^heyo-decision$/ }, () => ({
        path: join(folder, 'index.ts'),
      }));
      esbuild.onResolve({ filter: /.*/ }, (args) => {
        if (!inFolder(args.importer)) return undefined;
        if (/^\.\.\/core\/[\w-]+(\.ts)?$/.test(args.path)) {
          return { path: join(root, 'src/core', `${basename(args.path).replace(/\.ts$/, '')}.ts`) };
        }
        if (args.path.startsWith('./')) {
          const named = resolve(dirname(args.importer), args.path);
          const file = named.endsWith('.ts') ? named : `${named}.ts`;
          // The real path, so a link inside the folder cannot point out of it.
          if (existsSync(file) && inFolder(realpathSync(file))) return { path: file };
        }
        return {
          errors: [
            {
              text: `A decision may import only its own .ts files, ../core/geometry and ../core/types. It imports "${args.path}".`,
            },
          ],
        };
      });
    },
  };
}
