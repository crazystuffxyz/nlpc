#!/usr/bin/env node
// build.mjs - bundle nlpc into a single self-contained executable per OS.
// uses esbuild to inline all imports into one .cjs, then pkg to wrap that
// in a node runtime. output: dist/nlpc-<os>-<arch>
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { platform, arch } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve('.');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

// step 1: bundle bin/nlpc.mjs into a single .cjs. esbuild inlines every
// import from the project, plus node_modules, into one file.
const entry = join(root, 'bin', 'nlpc.mjs');
const bundle = join(dist, 'nlpc.bundle.cjs');

console.log('[build] esbuild bundling', entry);
await build({
  entryPoints: [entry],
  bundle: true,
  outfile: bundle,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  // minify disabled: esbuild's minifier emits syntax (optional chaining
  // patterns) that pkg@5's bundled babel chokes on. unminified bundles are
  // ~700KB but pkg then can package them fine.
  minify: false,
  // no banner: the shebang confuses babel inside pkg.
  logLevel: 'warning',
});

// step 2: pkg wraps the .cjs in a node runtime. targets cover win/mac/linux
// for both x64 and arm64. pkg fetches the right node binary on first run.
const targets = [
  { node: 'node18', platform: 'win', arch: 'x64', out: 'nlpc-win-x64.exe' },
  { node: 'node18', platform: 'linux', arch: 'x64', out: 'nlpc-linux-x64' },
  { node: 'node18', platform: 'linux', arch: 'arm64', out: 'nlpc-linux-arm64' },
  { node: 'node18', platform: 'macos', arch: 'x64', out: 'nlpc-macos-x64' },
  { node: 'node18', platform: 'macos', arch: 'arm64', out: 'nlpc-macos-arm64' },
];

// build only the host target by default to keep this fast on CI. cross
// builds require pre-fetched node binaries via `pkg-fetch`.
const host = `${platform()}-${arch()}`;
const wanted = process.env.NLPC_BUILD_ALL === '1'
  ? targets
  : targets.filter(t => `${t.platform === 'macos' ? 'darwin' : t.platform}-${t.arch}` === host);

for (const t of wanted) {
  const out = join(dist, t.out);
  console.log('[build] pkg ->', t.out);
  try {
    execSync(
      `npx pkg "${bundle}" --targets ${t.node}-${t.platform}-${t.arch} --output "${out}"`,
      { stdio: 'inherit' }
    );
  } catch (e) {
    console.error(`[build] pkg failed for ${t.out}:`, e.message);
    if (!process.env.NLPC_BUILD_ALL) process.exit(1);
    // continue on cross-build failures in NLPC_BUILD_ALL mode
  }
}

console.log('[build] done. artifacts in', dist);
