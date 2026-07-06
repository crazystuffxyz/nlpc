// integration test - full pipeline minus LLM and minus the real g++/cmake build.
// uses buildIR + codegen + cmake emitter to produce a self-consistent project
// then parses the produced main.cpp and CMakeLists.txt to ensure they're sane.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseStructured } from '../../lib/parser/structured.mjs';
import { buildIR } from '../../lib/ir/builder.mjs';
import { setReqFmt, emitCpp } from '../../lib/codegen/emit.mjs';
import { emitProject } from '../../lib/codegen/cmake.mjs';

test('greeter.nlp produces a compilable project (offline)', () => {
  const src = `Create a console application.\n\nRequire the fmt library.\n\nMake a function called greet that takes a person's name and returns a string.\n\nWhen the program starts:\n    ask the user for their name\n    print the greeting\n`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'greeter');
  setReqFmt(true);
  const cpp = emitCpp(ir);
  const proj = emitProject(ir, 'greeter');
  assert.match(cpp, /int main\(\)/);
  assert.match(cpp, /std::getline/);
  assert.match(proj.cmake, /fmt/);
  const deps = JSON.parse(proj.vcpkg).dependencies;
  assert.ok(deps.includes('fmt'));
});

test('rest-server.nlp produces http server scaffold', () => {
  const src = `Application:\n    type: REST API\n\nRequire the HTTP client library.\n\nWhen the program starts:\n    serve on port 8080\n\nGET /hello`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'rest');
  const cpp = emitCpp(ir);
  const proj = emitProject(ir, 'rest');
  assert.match(cpp, /httplib::Server/);
  assert.match(cpp, /svr\.get\("\/hello"/);
  assert.match(proj.cmake, /cpp-httplib/);
  const deps = JSON.parse(proj.vcpkg).dependencies;
  assert.ok(deps.includes('cpp-httplib'));
});

test('writing project to a temp dir produces a complete set of files', () => {
  const src = `When the program starts:\n    print hi`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'tmpapp');
  const cpp = emitCpp(ir);
  const proj = emitProject(ir, 'tmpapp');
  const dir = resolve(tmpdir(), 'nlpc-test-' + Date.now());
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'main.cpp'), cpp, 'utf8');
  writeFileSync(join(dir, 'CMakeLists.txt'), proj.cmake, 'utf8');
  writeFileSync(join(dir, 'vcpkg.json'), proj.vcpkg, 'utf8');
  assert.ok(existsSync(join(dir, 'main.cpp')));
  assert.ok(existsSync(join(dir, 'CMakeLists.txt')));
  assert.ok(existsSync(join(dir, 'vcpkg.json')));
  rmSync(dir, { recursive: true, force: true });
});
