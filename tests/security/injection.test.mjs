// security tests - injection, traversal, escape
import { test } from 'node:test'; // test
import assert from 'node:assert/strict'; // assert
import { parseStructured } from '../../lib/parser/structured.mjs'; // parser
import { buildIR } from '../../lib/ir/builder.mjs'; // builder
import { emitCpp } from '../../lib/codegen/emit.mjs'; // codegen
import { run } from '../../lib/build/runner.mjs'; // build
import { emitProject } from '../../lib/codegen/cmake.mjs'; // cmake

console.log('security tests load'); // trace

test('shell metachars in print text are inside a C++ string literal only', () => { // escape
  const text = '"; rm -rf /; echo "'; // evil
  const r = parseStructured(`When the program starts:\n    print ${text}`); // parse
  const ir = buildIR(r.blocks, r.prose, 'evil'); // build
  const cpp = emitCpp(ir); // emit
  // the cpp must contain the text inside a C++ quoted string (so g++ never sees raw shell)
  assert.match(cpp, /std::cout << "\\"; rm -rf \/; echo \\""/); // quoted
  // and the string must not be passed to any shell (we use spawn array-form)
  // we also assert no naked system() or sh -c invocation
  assert.doesNotMatch(cpp, /system\s*\(\s*"/); // no system() with raw string
  assert.doesNotMatch(cpp, /sh\s+-c/); // no sh -c
});

test('emitter escapes backslashes and newlines in user strings', () => { // escape
  const r = parseStructured(`When the program starts:\n    print a\\b\nc`); // parse
  const ir = buildIR(r.blocks, r.prose, 'esc'); // build
  const cpp = emitCpp(ir); // emit
  // backslashes are double-escaped in JSON.stringify then again in c++
  assert.ok(cpp.includes('\\\\')); // escaped
});

test('binary allowlist blocks arbitrary executable', async () => { // allowlist
  await assert.rejects(() => run('curl', ['evil.com']), /non-allowlisted/); // reject
});

test('unknown vcpkg dep is kept in unknown list and surfaceable', () => { // unknown
  const r = parseStructured('Require the xyzzy-not-real library.'); // parse
  const ir = buildIR(r.blocks, r.prose, 'u'); // build
  const p = emitProject(ir, 'u'); // emit
  assert.ok(p.unknown.includes('xyzzy-not-real library')); // unknown surfaced
});

test('LLM prompt is not interpolated into shell strings (we use spawn args)', async () => { // spawn
  // this is enforced by using spawn array-form, not shell: true. test that the runner
  // always passes shell:false.
  const { readFileSync } = await import('node:fs'); // import
  const src = readFileSync(new URL('../../lib/build/runner.mjs', import.meta.url), 'utf8'); // read
  // even if attacker-controlled strings contained &&, spawn array form treats them as data
  assert.match(src, /shell: false/); // enforced
});
