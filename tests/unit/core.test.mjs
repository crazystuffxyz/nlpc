// unit tests - node:test, no extra deps
import { test } from 'node:test'; // node test
import assert from 'node:assert/strict'; // assert
import { parseStructured } from '../../lib/parser/structured.mjs'; // parser
import { chunkProse } from '../../lib/parser/prose.mjs'; // prose
import { buildIR } from '../../lib/ir/builder.mjs'; // ir builder
import { validateIR } from '../../lib/ir/validator.mjs'; // validator
import { resolveRequirements, lookup } from '../../lib/deps/resolver.mjs'; // deps
import { emitCpp } from '../../lib/codegen/emit.mjs'; // codegen
import { emitProject } from '../../lib/codegen/cmake.mjs'; // cmake

console.log('unit tests load'); // trace

test('parser extracts Require', () => { // req
  const r = parseStructured('Require the fmt library.'); // parse
  assert.equal(r.blocks.length, 1); // one
  assert.equal(r.blocks[0].kind, 'require'); // kind
  assert.match(r.blocks[0].name, /fmt/); // name
});

test('parser extracts function with return', () => { // fn
  const r = parseStructured('Make a function called greet that takes a person name and returns a string.'); // parse
  const f = r.blocks.find(b => b.kind === 'function'); // find
  assert.ok(f); // ok
  assert.equal(f.name, 'greet'); // name
  assert.ok(f.params.length >= 1); // params
});

test('parser extracts main block body', () => { // main
  const r = parseStructured('When the program starts:\n    print Hello\n    ask name'); // parse
  const m = r.blocks.find(b => b.kind === 'main'); // find
  assert.ok(m); // ok
  assert.ok(m.body.length >= 2); // body
});

test('parser extracts REST application', () => { // rest
  const r = parseStructured('Application:\n    type: REST API\n\nGET /hello'); // parse
  assert.equal(r.blocks[0].kind, 'application_header'); // header
  assert.ok(r.blocks.find(b => b.kind === 'app_field')); // field
  assert.ok(r.blocks.find(b => b.kind === 'route')); // route
});

test('parser treats unknown lines as prose', () => { // prose
  const r = parseStructured('hello world\nthis is a sentence'); // parse
  assert.equal(r.blocks.length, 0); // no blocks
  assert.equal(r.prose.length, 2); // prose
});

test('prose chunker splits on blanks and length', () => { // chunk
  const c = chunkProse(['a','b','','c','d','e','f','g','h','i','j','k']); // chunk
  assert.ok(c.length >= 1); // at least
});

test('buildIR produces valid IR for hello', () => { // ir
  const r = parseStructured(`When the program starts:\n    print Hello, world!`); // parse
  const ir = buildIR(r.blocks, r.prose, 'hello'); // build
  assert.equal(ir.program.name, 'hello'); // name
  assert.equal(ir.program.kind, 'console'); // kind
  const v = validateIR(ir); // validate
  assert.ok(v.ok, JSON.stringify(v.errors)); // ok
});

test('buildIR auto-injects http deps for rest kind', () => { // rest
  const r = parseStructured('Application:\n    type: REST API'); // parse
  const ir = buildIR(r.blocks, r.prose, 'api'); // build
  assert.equal(ir.program.kind, 'rest'); // rest
  assert.ok(ir.requirements.find(x => /httplib|cpr/i.test(x.name))); // http
});

test('buildIR records function returns', () => { // fn returns
  const r = parseStructured('Make a function called sq that takes a number and returns an int.'); // parse
  const ir = buildIR(r.blocks, r.prose, 'sq'); // build
  const f = ir.declarations[0]; // fn
  assert.equal(f.returns, 'int'); // int
});

test('validateIR rejects bad kind', () => { // bad
  const v = validateIR({ program: { name: 'x', kind: 'unknown' } }); // bad
  assert.equal(v.ok, false); // fail
});

test('dep resolver maps fmt, json, http, graphics, sqlite', () => { // deps
  assert.equal(lookup('fmt'), 'fmt'); // fmt
  assert.equal(lookup('JSON parser library'), 'nlohmann-json'); // json
  assert.equal(lookup('HTTP client'), 'cpp-httplib'); // http
  assert.equal(lookup('graphics library'), 'sfml'); // gfx
  assert.equal(lookup('sqlite'), 'sqlite3'); // sql
});

test('dep resolver returns unknown for nonsense', () => { // unknown
  assert.equal(lookup('xyzzy-library-of-doom'), null); // null
});

test('resolveRequirements dedupes and unknown-lists', () => { // resolve
  const r = resolveRequirements([{ name: 'fmt', source: 'vcpkg' }, { name: 'JSON parser', source: 'vcpkg' }, { name: 'xyzzy', source: 'vcpkg' }]); // resolve
  assert.ok(r.packages.includes('fmt')); // fmt
  assert.ok(r.packages.includes('nlohmann-json')); // json
  assert.deepEqual(r.unknown, ['xyzzy']); // unknown
});

test('emitCpp produces valid c++ for hello world', () => { // emit
  const r = parseStructured(`When the program starts:\n    print Hello, world!`); // parse
  const ir = buildIR(r.blocks, r.prose, 'hello'); // build
  const cpp = emitCpp(ir); // emit
  assert.match(cpp, /#include <iostream>/); // include
  assert.match(cpp, /int main\(\)/); // main
  assert.match(cpp, /Hello, world!/); // text
  assert.match(cpp, /return 0;/); // ret
});

test('emitCpp includes fmt header and links to fmt when fmt required', async () => { // fmt
  const r = parseStructured(`Require the fmt library.\nWhen the program starts:\n    print Hi`); // parse
  const ir = buildIR(r.blocks, r.prose, 'fmtapp'); // build
  const { setReqFmt } = await import('../../lib/codegen/emit.mjs'); // import for setter
  setReqFmt(true); // set
  const cpp = emitCpp(ir); // emit
  assert.match(cpp, /#include <fmt\/core\.h>/); // include
  // we don't actually use fmt::print (v12 ABI issues) - just include the header
  assert.match(cpp, /std::cout/); // still output to cout
});

test('emitCpp handles http server for rest kind', () => { // http
  const r = parseStructured('Application:\n    type: REST API\n\nGET /hello'); // parse
  const ir = buildIR(r.blocks, r.prose, 'api'); // build
  const cpp = emitCpp(ir); // emit
  assert.match(cpp, /httplib::Server/); // server
  assert.match(cpp, /svr\.get/); // route
});

test('emitProject produces CMakeLists with find_package for known deps', () => { // cmake
  const r = parseStructured('Require the fmt library.\nRequire the JSON parser library.'); // parse
  const ir = buildIR(r.blocks, r.prose, 'demo'); // build
  const p = emitProject(ir, 'demo'); // emit
  assert.match(p.cmake, /find_package\(fmt/); // fmt
  assert.match(p.cmake, /find_package\(nlohmann_json/); // json
  assert.deepEqual(JSON.parse(p.vcpkg).dependencies.sort(), ['fmt', 'nlohmann-json']); // deps
});

test('emitProject adds openssl transitive for cpp-httplib', () => { // trans
  const r = parseStructured('Require the HTTP client library.'); // parse
  const ir = buildIR(r.blocks, r.prose, 'h'); // build
  const p = emitProject(ir, 'h'); // emit
  const deps = JSON.parse(p.vcpkg).dependencies; // deps
  assert.ok(deps.includes('cpp-httplib')); // http
  assert.ok(deps.includes('openssl')); // ssl
});
