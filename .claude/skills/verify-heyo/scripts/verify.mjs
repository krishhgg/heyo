#!/usr/bin/env node
// Drives the built heyo extension in Playwright's Chromium and saves evidence.
//
//   verify.mjs doctor            read-only health check
//   verify.mjs run <feature>     drive one feature from scripts/drives/
//   verify.mjs list              list the features that have a drive
//
// Each run uses a fresh browser profile and its own fixture server on a free
// port, so two runs can go side by side.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const drivesDir = fileURLToPath(new URL('./drives/', import.meta.url));
const evidenceRoot = join(root, '.verify', 'evidence');

const { launchWithExtension, extensionDir } = await import(join(root, 'e2e/helpers/extension.ts'));
const { startFixtureServer } = await import(join(root, 'e2e/server.mjs'));

async function newestMtime(dir) {
  let newest = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const { mtimeMs } = await stat(join(entry.parentPath, entry.name));
    newest = Math.max(newest, mtimeMs);
  }
  return newest;
}

/** Checks the build without starting a browser. Returns a list of problems. */
async function checkBuild() {
  const problems = [];
  const manifestPath = join(extensionDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return ['dist/extension is missing. Run `npm run build`.'];
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) {
    problems.push(`The build is version ${manifest.version} but package.json is ${pkg.version}.`);
  }
  const built = (await stat(manifestPath)).mtimeMs;
  if ((await newestMtime(join(root, 'src'))) > built) {
    problems.push('src/ changed after the last build. Run `npm run build`.');
  }
  return problems;
}

/** Starts a fixture server and a browser with the extension, runs fn, then tears both down. */
async function withSession(fn, { headed = false, video = null } = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'heyo-verify-'));
  const { server, port } = await startFixtureServer(0);
  let session;
  try {
    session = await launchWithExtension(profile, { headless: !headed, recordVideoDir: video });
    const page = session.context.pages()[0] ?? (await session.context.newPage());
    return await fn({ ...session, page, baseUrl: `http://127.0.0.1:${port}` });
  } finally {
    await session?.context.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
}

async function pingActiveTab(worker) {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return heyo.pingTab(tab.id);
  });
}

async function doctor() {
  const problems = await checkBuild();
  if (problems.length === 0) {
    try {
      await withSession(async ({ page, worker, baseUrl }) => {
        await page.goto(`${baseUrl}/basic.html`);
        const reply = await pingActiveTab(worker);
        if (!reply?.ok) problems.push('The content script did not answer a ping.');
        else console.log(`ok  extension ${reply.version} loaded, content script answered`);
      });
    } catch (error) {
      problems.push(`The browser session failed: ${error.message}`);
    }
  }
  for (const problem of problems) console.log(`bad ${problem}`);
  console.log(problems.length === 0 ? 'doctor: healthy' : 'doctor: not healthy');
  return problems.length === 0 ? 0 : 1;
}

async function listDrives() {
  const files = existsSync(drivesDir) ? await readdir(drivesDir) : [];
  return files.filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, ''));
}

async function run(feature, flags) {
  const drives = await listDrives();
  if (!drives.includes(feature)) {
    console.log(`No drive named "${feature}". Available: ${drives.join(', ') || 'none'}`);
    return 2;
  }
  const problems = await checkBuild();
  if (problems.length > 0) {
    for (const problem of problems) console.log(`bad ${problem}`);
    return 1;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evidence = join(evidenceRoot, `${stamp}-${feature}`);
  await mkdir(evidence, { recursive: true });
  const lines = [];
  const log = (line) => {
    lines.push(line);
    console.log(line);
  };
  const { drive } = await import(join(drivesDir, `${feature}.mjs`));
  let code = 0;
  try {
    await withSession((session) => drive({ ...session, evidence, log, pingActiveTab }), {
      headed: flags.includes('--headed'),
      video: flags.includes('--video') ? evidence : null,
    });
    log(`PASS ${feature}`);
  } catch (error) {
    log(`FAIL ${feature}: ${error.stack ?? error.message}`);
    code = 1;
  }
  await writeFile(join(evidence, 'transcript.txt'), `${lines.join('\n')}\n`);
  console.log(`evidence: ${evidence}`);
  return code;
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'doctor') process.exit(await doctor());
else if (command === 'list') console.log((await listDrives()).join('\n'));
else if (command === 'run' && rest[0]) process.exit(await run(rest[0], rest.slice(1)));
else {
  console.log('usage: verify.mjs doctor | list | run <feature> [--headed] [--video]');
  process.exit(2);
}
