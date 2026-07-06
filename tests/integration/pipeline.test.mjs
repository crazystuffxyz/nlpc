// integration test - full pipeline minus LLM and minus the real g++/cmake build.
// uses buildIR + codegen + cmake emitter to produce a self-consistent project
// then parses the produced main.cpp and CMakeLists.txt to ensure they're sane.
import { test } from 'node:test'; // test
import assert from 'node:assert/strict'; // assert
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'; // fs
import { resolve, join } from 'node:path'; // path
import { tmpdir } from 'node:os'; // os
import { parseStructured } from '../../lib/parser/structured.mjs'; // parser
import { buildIR } from '../../lib/ir/builder.mjs'; // builder
import { setReqFmt, emitCpp } from '../../lib/codegen/emit.mjs'; // emit
import { emitProject } from '../../lib/codegen/cmake.mjs'; // cmake

console.log('integration tests load'); // trace

test('greeter.nlp produces a compilable project (offline)', () => { // full
  const src = `Create a console application.\n\nRequire the fmt library.\n\nMake a function called greet that takes a person's name and returns a string.\n\nWhen the program starts:\n    ask the user for their name\n    print the greeting\n`; // src
  const { blocks, prose } = parseStructured(src); // parse
  const ir = buildIR(blocks, prose, 'greeter'); // build
  setReqFmt(true); // fmt
  const cpp = emitCpp(ir); // emit
  const proj = emitProject(ir, 'greeter'); // emit
  // sanity
  assert.match(cpp, /int main\(\)/); // main
  assert.match(cpp, /std::getline/); // getline
  assert.match(proj.cmake, /fmt/); // cmake
  const deps = JSON.parse(proj.vcpkg).dependencies; // deps
  assert.ok(deps.includes('fmt')); // fmt
});

test('rest-server.nlp produces http server scaffold', () => { // rest
  const src = `Application:\n    type: REST API\n\nRequire the HTTP client library.\n\nWhen the program starts:\n    serve on port 8080\n\nGET /hello`; // src
  const { blocks, prose } = parseStructured(src); // parse
  const ir = buildIR(blocks, prose, 'rest'); // build
  const cpp = emitCpp(ir); // emit
  const proj = emitProject(ir, 'rest'); // emit
  assert.match(cpp, /httplib::Server/); // server
  assert.match(cpp, /svr\.get\("\/hello"/); // route
  assert.match(proj.cmake, /cpp-httplib/); // http
  const deps = JSON.parse(proj.vcpkg).dependencies; // deps
  assert.ok(deps.includes('cpp-httplib')); // http
});

test('writing project to a temp dir produces a complete set of files', () => { // files
  const src = `When the program starts:\n    print hi`; // src
  const { blocks, prose } = parseStructured(src); // parse
  const ir = buildIR(blocks, prose, 'tmpapp'); // build
  const cpp = emitCpp(ir); // emit
  const proj = emitProject(ir, 'tmpapp'); // emit
  const dir = resolve(tmpdir(), 'nlpc-test-' + Date.now()); // dir
  mkdirSync(dir, { recursive: true }); // mk
  writeFileSync(join(dir, 'main.cpp'), cpp, 'utf8'); // write
  writeFileSync(join(dir, 'CMakeLists.txt'), proj.cmake, 'utf8'); // write
  writeFileSync(join(dir, 'vcpkg.json'), proj.vcpkg, 'utf8'); // write
  assert.ok(existsSync(join(dir, 'main.cpp'))); // exists
  assert.ok(existsSync(join(dir, 'CMakeLists.txt'))); // exists
  assert.ok(existsSync(join(dir, 'vcpkg.json'))); // exists
  // clean up
  rmSync(dir, { recursive: true, force: true }); // rm
});
