// e2e test - actually compile and run a tiny program with the local toolchain.
// skipped if g++/cmake/vcpkg are not all available.
import { test, skip } from 'node:test'; // test
import assert from 'node:assert/strict'; // assert
import { execFile } from 'node:child_process'; // exec
import { promisify } from 'node:util'; // util
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'; // fs
import { resolve, join, dirname } from 'node:path'; // path
import { tmpdir } from 'node:os'; // os
import { fileURLToPath } from 'node:url'; // url

const ex = promisify(execFile); // promise
const __dirname = dirname(fileURLToPath(import.meta.url)); // our dir
const ROOT = resolve(__dirname, '..', '..'); // root
const VCPKG = process.env.VCPKG_ROOT || resolve(process.env.HOME || process.env.USERPROFILE, 'vcpkg-master'); // root

console.log('e2e tests load, vcpkg', VCPKG); // trace

// probe tools
async function haveTools() { // check
  try { await ex('g++', ['--version']); await ex('cmake', ['--version']); if (!existsSync(VCPKG)) return false; return true; } // ok
  catch { return false; } // fail
}

const ok = await haveTools(); // check
const it = ok ? test : skip; // choose

it('compile a hello-world .nlp to a running executable', async () => { // e2e
  const dir = resolve(tmpdir(), 'nlpc-e2e-' + Date.now()); // dir
  mkdirSync(dir, { recursive: true }); // mk
  // we'll exercise the full runner
  process.env.NLPC_OFFLINE = '1'; // offline
  const { run } = await import('../../lib/runner.mjs'); // import runner
  const cfg = { // cfg
    model: 'codellama:7b-instruct',
    ollamaHost: 'http://127.0.0.1:11434',
    vcpkgRoot: VCPKG,
    cmake: 'cmake',
    cxx: 'g++',
    repairMax: 2,
    timeoutMs: 120_000,
    buildType: 'Release',
  };
  const file = resolve(ROOT, 'examples', 'hello.nlp'); // hello
  try { // try
    const res = await run({ file, opts: { out: dir, repair: false, noLlm: true }, cfg, spinner: null }); // run
    assert.ok(existsSync(res.binary), 'binary should exist at ' + res.binary); // exists
    const { stdout } = await ex(res.binary, []); // run
    assert.match(stdout, /Hello, world!/); // check
  } finally { // clean
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env.NLPC_OFFLINE; // clean env
  }
}, { timeout: 180_000 });
