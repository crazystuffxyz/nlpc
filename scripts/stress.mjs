#!/usr/bin/env node
// stress runner - lower each .nlp via the real pipeline (no LLM) and
// capture the generated c++ + the cmake-driven compile result.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseStructured } from '../lib/parser/structured.mjs';
import { buildIR } from '../lib/ir/builder.mjs';
import { emitCpp } from '../lib/codegen/emit.mjs';
import { emitProject } from '../lib/codegen/cmake.mjs';

const stressDir = resolve(process.cwd(), 'examples');
const outRoot = resolve(process.cwd(), 'build-out/stress');
if (existsSync(outRoot)) rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

const files = [
  'stress-types.nlp',
  'stress-injection.nlp',
  'stress-rest.nlp',
  'stress-control.nlp',
  'stress-literals.nlp',
];

let pass = 0, fail = 0;
const results = [];

for (const f of files) {
  const name = basename(f, '.nlp');
  const dir = join(outRoot, name);
  mkdirSync(dir, { recursive: true });
  let lowered = '';
  let ir = null;
  let cpp = '';
  let cmake = '';
  let vcpkg = '';
  let compileOk = null;
  let err = '';
  let securityFlags = [];
  try {
    const src = readFileSync(join(stressDir, f), 'utf8');
    const { blocks, prose } = parseStructured(src);
    ir = buildIR(blocks, prose, name);
    cpp = emitCpp(ir);
    const proj = emitProject(ir, name);
    cmake = proj.cmake;
    vcpkg = proj.vcpkg;
    writeFileSync(join(dir, 'main.cpp'), cpp, 'utf8');
    writeFileSync(join(dir, 'CMakeLists.txt'), cmake, 'utf8');
    writeFileSync(join(dir, 'vcpkg.json'), vcpkg, 'utf8');
    writeFileSync(join(dir, 'ir.json'), JSON.stringify(ir, null, 2), 'utf8');
    lowered = 'ok';
  } catch (e) {
    err = 'lowering: ' + (e.message || e);
  }

  // security heuristics
  // raw is a deliberate user escape hatch; only flag system() when it
  // appears outside a `// unsafe raw` comment we emitted. (we don't emit
  // one for plain raw, so this is "always flag" today. that's correct:
  // we want to know when stress inputs are exercising raw c++. if the
  // user wrote `raw std::system(...)` it's still a finding, just an
  // expected one.)
  if (cpp.match(/^\s*std::system\s*\(/m) || cpp.match(/[^\/]std::system\s*\(/)) {
    securityFlags.push('system() in cpp (raw escape used)');
  }
  // path traversal: only flag if `../` appears as a path argument
  // outside a quoted string. we keep the check loose - the goal is
  // to surface it during stress, not to whitelist all user input.
  if (cpp.match(/["']\.\.\/\.\.\/["']/)) {
    securityFlags.push('path traversal literal in cpp (likely user input)');
  }
  if (ir && ir.program?.name && !/^[a-z0-9_]+$/.test(ir.program.name)) securityFlags.push('unsafe program.name: ' + ir.program.name);

  // try to compile if cmake + g++ + vcpkg are on path
  if (lowered === 'ok') {
    try {
      execFileSync('cmake', ['--version'], { stdio: 'ignore' });
      execFileSync('g++', ['--version'], { stdio: 'ignore' });
      const vcpkgRoot = process.env.VCPKG_ROOT || 'C:/Users/Shaya/vcpkg-master';
      const toolchain = resolve(vcpkgRoot, 'scripts/buildsystems/vcpkg.cmake');
      if (existsSync(toolchain)) {
        // vcpkg installs with whatever triplet it auto-detects. on
        // windows with mingw g++ on PATH, that auto-detect can still
        // pick MSVC if cl.exe is also on PATH (and it is, in this
        // env). forcing the triplet here keeps the install aligned
        // with the toolchain we actually link with.
        const triplet = process.env.VCPKG_TARGET_TRIPLET || (process.platform === 'win32' ? 'x64-mingw-dynamic' : '');
        const vcpkgArgs = ['install', '--x-install-root=' + resolve(dir, 'vcpkg_installed')];
        if (triplet) vcpkgArgs.push('--triplet=' + triplet);
        try {
          execFileSync('vcpkg', vcpkgArgs, { cwd: dir, stdio: 'pipe' });
        } catch (e) {
          // vcpkg may not be on PATH; fall back to vcpkg binary in root
          const vcpkgBin = process.platform === 'win32' ? 'vcpkg.exe' : 'vcpkg';
          execFileSync(resolve(vcpkgRoot, vcpkgBin), vcpkgArgs, { cwd: dir, stdio: 'pipe' });
        }
        execFileSync('cmake', ['-B', 'build', '-S', '.', `-DCMAKE_TOOLCHAIN_FILE=${toolchain}`, '-DCMAKE_BUILD_TYPE=Release'], { cwd: dir, stdio: 'pipe' });
        execFileSync('cmake', ['--build', 'build', '--config', 'Release'], { cwd: dir, stdio: 'pipe' });
        compileOk = true;
      } else {
        compileOk = 'no-toolchain';
      }
    } catch (e) {
      compileOk = false;
      err = 'compile: ' + (e.stderr?.toString().split('\n').slice(0, 8).join(' | ') || e.message || e);
    }
  }

  // a stress test "passes" if the lowerer produces a valid build that
  // compiles. security flags are *reported* (so we know what the
  // stress input exercised) but do not fail the case - they are the
  // point of having stress files. a file that uses raw c++ to call
  // system() is the file working as designed.
  const ok = lowered === 'ok' && compileOk === true;
  if (ok) pass++; else fail++;
  results.push({ file: f, lowered, compileOk, err, securityFlags, name });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${f}  compile=${compileOk}${securityFlags.length ? '  security=[' + securityFlags.join(',') + ']' : ''}${err ? '  err=' + err.slice(0, 300) : ''}`);
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
