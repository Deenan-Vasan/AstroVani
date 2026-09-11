#!/usr/bin/env node
/**
 * Download remedy imagery listed in remedy-images.json into public/remedies/.
 *
 * The Kundli puja card used to hotlink a Wikimedia URL directly. When that stopped
 * resolving, the card rendered raw alt text over an empty box — and this app already runs
 * behind a network that blocks third-party hosts. Images are now served from our own
 * origin, with a drawn SVG fallback when a file is absent.
 *
 * The manifest ships EMPTY on purpose: which images to use is a licensing decision for
 * whoever runs this, not something to bake into the repo.
 *
 * Node built-ins only. Never fails the build.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');
const targetDir = join(frontendRoot, 'public', 'remedies');
const manifestPath = join(here, 'remedy-images.json');
const MIN_BYTES = 8_000; // anything smaller is an error page, not a photograph
const force = process.argv.includes('--force');

const log = (...args) => console.log('[setup-remedy-images]', ...args);

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch (error) {
  log(`could not read ${manifestPath}: ${error instanceof Error ? error.message : error}`);
  log('skipping — the UI will use its drawn fallbacks.');
  process.exit(0);
}

const entries = Object.entries(manifest.images ?? {}).filter(([, url]) => typeof url === 'string' && url.trim());
if (!entries.length) {
  log('manifest has no image URLs — nothing to download.');
  log('The UI will use its drawn fallbacks, which is a supported state.');
  log(`To install photographs, either drop files into public/remedies/ or add URLs to ${manifestPath}.`);
  process.exit(0);
}

await mkdir(targetDir, { recursive: true });

for (const [name, url] of entries) {
  const target = join(targetDir, `${name}.jpg`);
  if (!force && await exists(target)) {
    const info = await stat(target);
    if (info.size >= MIN_BYTES) { log(`${name}.jpg already present (${Math.round(info.size / 1024)}KB), skipping`); continue; }
    log(`${name}.jpg looks truncated; re-downloading`);
  }
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) throw new Error(`expected an image, got "${type}"`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < MIN_BYTES) throw new Error(`unexpectedly small response (${bytes.length} bytes)`);
    await writeFile(target, bytes);
    log(`saved ${name}.jpg (${Math.round(bytes.length / 1024)}KB)`);
  } catch (error) {
    log(`WARNING: ${name} could not be downloaded: ${error instanceof Error ? error.message : error}`);
    log(`  the drawn fallback will be used for "${name}".`);
  }
}

console.log('');
log('--- verification ---');
for (const [name] of entries) {
  log(`  ${await exists(join(targetDir, `${name}.jpg`)) ? 'OK     ' : 'MISSING'}  public/remedies/${name}.jpg`);
}
