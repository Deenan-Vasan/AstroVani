#!/usr/bin/env node
/**
 * Self-host the MediaPipe Hand Landmarker assets.
 *
 * Palmistry previously loaded the tasks-vision WASM from jsdelivr/unpkg and the
 * hand_landmarker model from storage.googleapis.com at runtime. When any of those is
 * blocked - corporate proxy, offline dev, CDN hiccup - the detector fails to
 * initialize, Palmistry loses every hand landmark, and palm capture is disabled.
 * Serving the assets from our own origin removes that failure mode.
 *
 * Uses Node built-ins only, so it adds no dependency and cannot itself fail to install.
 * Safe to re-run: existing files are left alone unless --force is passed.
 */

import { access, cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');
const publicDir = join(frontendRoot, 'public');
const wasmTarget = join(publicDir, 'mediapipe', 'wasm');
const modelDir = join(publicDir, 'models');
const modelTarget = join(modelDir, 'hand_landmarker.task');

// The file MediaPipe's FilesetResolver actually requests. Used both as the copy
// success criterion and as the runtime probe target.
const WASM_ENTRY = 'vision_wasm_internal.js';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MIN_MODEL_BYTES = 1_000_000; // the real model is ~7.5MB; anything smaller is an error page
const force = process.argv.includes('--force');

const log = (...args) => console.log('[setup-mediapipe]', ...args);

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate the installed package by walking node_modules directories directly.
 *
 * Deliberately NOT `require.resolve('@mediapipe/tasks-vision/package.json')`: packages
 * that define an `exports` map without an explicit `"./package.json"` entry make that
 * throw ERR_PACKAGE_PATH_NOT_EXPORTED even when perfectly installed. That is exactly
 * what happened here - the copy was skipped with a misleading "not installed" warning
 * while the model download succeeded, leaving a half-installed state that failed at
 * runtime with an opaque WASM error.
 *
 * npm workspaces hoist to the repo root, so check upward from the frontend package.
 */
async function findPackageDir() {
  const roots = [frontendRoot, resolve(frontendRoot, '..'), resolve(frontendRoot, '..', '..')];
  for (const root of roots) {
    const candidate = join(root, 'node_modules', '@mediapipe', 'tasks-vision');
    if (await exists(candidate)) return candidate;
  }
  return null;
}

/** Find the directory containing WASM_ENTRY, in case the package layout ever changes. */
async function findWasmDir(packageDir) {
  const direct = join(packageDir, 'wasm');
  if (await exists(join(direct, WASM_ENTRY))) return direct;
  try {
    for (const entry of await readdir(packageDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nested = join(packageDir, entry.name);
      if (await exists(join(nested, WASM_ENTRY))) return nested;
    }
  } catch { /* unreadable package directory */ }
  if (await exists(join(packageDir, WASM_ENTRY))) return packageDir;
  return null;
}

async function copyWasm() {
  if (!force && await exists(join(wasmTarget, WASM_ENTRY))) {
    log('WASM already present, skipping (use --force to refresh)');
    return true;
  }
  const packageDir = await findPackageDir();
  if (!packageDir) {
    log('WARNING: @mediapipe/tasks-vision is not installed. Run `npm install` first, then re-run this script.');
    return false;
  }
  const source = await findWasmDir(packageDir);
  if (!source) {
    log(`WARNING: found the package at ${packageDir} but no ${WASM_ENTRY} inside it.`);
    return false;
  }
  await mkdir(dirname(wasmTarget), { recursive: true });
  await rm(wasmTarget, { recursive: true, force: true });
  await cp(source, wasmTarget, { recursive: true });
  // Verify rather than assume: a silent half-copy is what caused the runtime failure.
  if (!await exists(join(wasmTarget, WASM_ENTRY))) {
    log(`WARNING: copy completed but ${WASM_ENTRY} is missing from the target.`);
    return false;
  }
  log(`copied WASM from ${source} -> public/mediapipe/wasm`);
  return true;
}

async function downloadModel() {
  if (!force && await exists(modelTarget)) {
    const info = await stat(modelTarget);
    if (info.size >= MIN_MODEL_BYTES) {
      log(`model already present (${(info.size / 1e6).toFixed(1)}MB), skipping`);
      return true;
    }
    log('existing model file looks truncated; re-downloading');
  }
  await mkdir(modelDir, { recursive: true });
  log('downloading hand_landmarker.task (~7.5MB)…');
  try {
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < MIN_MODEL_BYTES) throw new Error(`unexpectedly small response (${bytes.length} bytes)`);
    await writeFile(modelTarget, bytes);
    log(`saved model -> public/models/hand_landmarker.task (${(bytes.length / 1e6).toFixed(1)}MB)`);
    return true;
  } catch (error) {
    log(`WARNING: could not download the model: ${error instanceof Error ? error.message : error}`);
    log('  Download it manually from:');
    log(`    ${MODEL_URL}`);
    log(`  and save it to: ${modelTarget}`);
    return false;
  }
}

const wasmOk = await copyWasm();
const modelOk = await downloadModel();

// Always end with an explicit inventory. The previous version's warnings scrolled past
// in concurrently's interleaved output, so a half-installed state looked like success.
console.log('');
log('--- verification ---');
log(`  WASM  ${await exists(join(wasmTarget, WASM_ENTRY)) ? 'OK  ' : 'MISSING'}  public/mediapipe/wasm/${WASM_ENTRY}`);
log(`  model ${await exists(modelTarget) ? 'OK  ' : 'MISSING'}  public/models/hand_landmarker.task`);

if (wasmOk && modelOk) {
  log('ready — Palmistry will load the hand detector from this origin.');
} else {
  log('INCOMPLETE — Palmistry will try the CDNs, and will disable palm capture if those');
  log('are unreachable. Re-run `npm run setup:mediapipe` after fixing the above.');
}
// Never fail the build; the app reports the problem in the UI with per-asset detail.
