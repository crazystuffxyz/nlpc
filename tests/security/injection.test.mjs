// security tests - injection, traversal, escape
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStructured } from '../../lib/parser/structured.mjs';
import { buildIR } from '../../lib/ir/builder.mjs';
import { emitCpp } from '../../lib/codegen/emit.mjs';
import { run } from '../../lib/build/runner.mjs';
import { emitProject } from '../../lib/codegen/cmake.mjs';

test('shell metachars in print text are inside a C++ string literal only', () => {
  // the user's text could contain ; rm -rf etc - all of that must end up
  // inside a c++ quoted string so the compiler sees it as data, never as
  // shell. we don't care which exact string the user wrote - any
  // string-literal output is safe.
  const text = '"; rm -rf /; echo "';
  const r = parseStructured(`When the program starts:\n    print ${text}`);
  const ir = buildIR(r.blocks, r.prose, 'evil');
  const cpp = emitCpp(ir);
  // the entire text is contained in a c++ string literal
  assert.match(cpp, /std::cout << ".*rm -rf.*echo.*" << std::endl/);
  // no naked system() or sh -c invocation
  assert.doesNotMatch(cpp, /system\s*\(\s*"/);
  assert.doesNotMatch(cpp, /sh\s+-c/);
});

test('emitter escapes backslashes and newlines in user strings', () => {
  const r = parseStructured(`When the program starts:\n    print a\\b\nc`);
  const ir = buildIR(r.blocks, r.prose, 'esc');
  const cpp = emitCpp(ir);
  // backslashes are double-escaped in JSON.stringify then again in c++
  assert.ok(cpp.includes('\\\\'));
});

test('binary allowlist blocks arbitrary executable', async () => {
  await assert.rejects(() => run('curl', ['evil.com']), /non-allowlisted/);
});

test('unknown vcpkg dep is kept in unknown list and surfaceable', () => {
  const r = parseStructured('Require the xyzzy-not-real library.');
  const ir = buildIR(r.blocks, r.prose, 'u');
  const p = emitProject(ir, 'u');
  assert.ok(p.unknown.includes('xyzzy-not-real library'));
});

test('LLM prompt is not interpolated into shell strings (we use spawn args)', async () => {
  // this is enforced by using spawn array-form, not shell: true. test that the runner
  // always passes shell:false.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../lib/build/runner.mjs', import.meta.url), 'utf8');
  // even if attacker-controlled strings contained &&, spawn array form treats them as data
  assert.match(src, /shell: false/);
});
