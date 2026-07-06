// e2e test - actually compile and run a tiny program with the local toolchain.
// skipped if g++/cmake/vcpkg are not all available.
import { test, skip } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ex = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const VCPKG = process.env.VCPKG_ROOT || resolve(process.env.HOME || process.env.USERPROFILE, 'vcpkg-master');

// probe tools
async function haveTools() {
  try { await ex('g++', ['--version']); await ex('cmake', ['--version']); if (!existsSync(VCPKG)) return false; return true; }
  catch { return false; }
}

const ok = await haveTools();
const it = ok ? test : skip;

it('compile a hello-world .nlp to a running executable', async () => {
  const dir = resolve(tmpdir(), 'nlpc-e2e-' + Date.now());
  mkdirSync(dir, { recursive: true });
  // we'll exercise the full runner
  process.env.NLPC_OFFLINE = '1';
  const { run } = await import('../../lib/runner.mjs');
  const cfg = {
    model: 'codellama:7b-instruct',
    ollamaHost: 'http://127.0.0.1:11434',
    vcpkgRoot: VCPKG,
    cmake: 'cmake',
    cxx: 'g++',
    repairMax: 2,
    timeoutMs: 120_000,
    buildType: 'Release',
  };
  const file = resolve(ROOT, 'examples', 'hello.nlp');
  try {
    const res = await run({ file, opts: { out: dir, repair: false, noLlm: true }, cfg, spinner: null });
    assert.ok(existsSync(res.binary), 'binary should exist at ' + res.binary);
    const { stdout } = await ex(res.binary, []);
    assert.match(stdout, /Hello, world!/);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env.NLPC_OFFLINE;
  }
}, { timeout: 180_000 });
