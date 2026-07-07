// unit tests - node:test, no extra deps
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStructured } from '../../lib/parser/structured.mjs';
import { chunkProse } from '../../lib/parser/prose.mjs';
import { buildIR } from '../../lib/ir/builder.mjs';
import { validateIR } from '../../lib/ir/validator.mjs';
import { resolveRequirements, lookup } from '../../lib/deps/resolver.mjs';
import { emitCpp } from '../../lib/codegen/emit.mjs';
import { emitProject } from '../../lib/codegen/cmake.mjs';

test('parser extracts Require', () => {
  const r = parseStructured('Require the fmt library.');
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].kind, 'require');
  assert.match(r.blocks[0].name, /fmt/);
});

test('parser extracts function with return', () => {
  const r = parseStructured('Make a function called greet that takes a person name and returns a string.');
  const f = r.blocks.find(b => b.kind === 'function');
  assert.ok(f);
  assert.equal(f.name, 'greet');
  assert.ok(f.params.length >= 1);
});

test('parser extracts main block body', () => {
  const r = parseStructured('When the program starts:\n    print Hello\n    ask name');
  const m = r.blocks.find(b => b.kind === 'main');
  assert.ok(m);
  assert.ok(m.body.length >= 2);
});

test('parser extracts REST application', () => {
  const r = parseStructured('Application:\n    type: REST API\n\nGET /hello');
  assert.equal(r.blocks[0].kind, 'application_header');
  assert.ok(r.blocks.find(b => b.kind === 'app_field'));
  assert.ok(r.blocks.find(b => b.kind === 'route'));
});

test('parser treats unknown lines as prose', () => {
  const r = parseStructured('hello world\nthis is a sentence');
  assert.equal(r.blocks.length, 0);
  assert.equal(r.prose.length, 2);
});

test('prose chunker splits on blanks and length', () => {
  const c = chunkProse(['a','b','','c','d','e','f','g','h','i','j','k']);
  assert.ok(c.length >= 1);
});

test('buildIR produces valid IR for hello', () => {
  const r = parseStructured(`When the program starts:\n    print Hello, world!`);
  const ir = buildIR(r.blocks, r.prose, 'hello');
  assert.equal(ir.program.name, 'hello');
  assert.equal(ir.program.kind, 'console');
  const v = validateIR(ir);
  assert.ok(v.ok, JSON.stringify(v.errors));
});

test('buildIR auto-injects http deps for rest kind', () => {
  const r = parseStructured('Application:\n    type: REST API');
  const ir = buildIR(r.blocks, r.prose, 'api');
  assert.equal(ir.program.kind, 'rest');
  assert.ok(ir.requirements.find(x => /httplib|cpr/i.test(x.name)));
});

test('buildIR records function returns', () => {
  const r = parseStructured('Make a function called sq that takes a number and returns an int.');
  const ir = buildIR(r.blocks, r.prose, 'sq');
  const f = ir.declarations[0];
  assert.equal(f.returns, 'int');
});

test('validateIR rejects bad kind', () => {
  const v = validateIR({ program: { name: 'x', kind: 'unknown' } });
  assert.equal(v.ok, false);
});

test('dep resolver maps fmt, json, http, graphics, sqlite', () => {
  assert.equal(lookup('fmt'), 'fmt');
  assert.equal(lookup('JSON parser library'), 'nlohmann-json');
  assert.equal(lookup('HTTP client'), 'cpp-httplib');
  assert.equal(lookup('graphics library'), 'sfml');
  assert.equal(lookup('sqlite'), 'sqlite3');
});

test('dep resolver returns unknown for nonsense', () => {
  assert.equal(lookup('xyzzy-library-of-doom'), null);
});

test('resolveRequirements dedupes and unknown-lists', () => {
  const r = resolveRequirements([{ name: 'fmt', source: 'vcpkg' }, { name: 'JSON parser', source: 'vcpkg' }, { name: 'xyzzy', source: 'vcpkg' }]);
  assert.ok(r.packages.includes('fmt'));
  assert.ok(r.packages.includes('nlohmann-json'));
  assert.deepEqual(r.unknown, ['xyzzy']);
});

test('emitCpp produces valid c++ for hello world', () => {
  const r = parseStructured(`When the program starts:\n    print Hello, world!`);
  const ir = buildIR(r.blocks, r.prose, 'hello');
  const cpp = emitCpp(ir);
  assert.match(cpp, /#include <iostream>/);
  assert.match(cpp, /int main\(\)/);
  assert.match(cpp, /Hello, world!/);
  assert.match(cpp, /return 0;/);
});

test('emitCpp includes fmt header and links to fmt when fmt required', async () => {
  const r = parseStructured(`Require the fmt library.\nWhen the program starts:\n    print Hi`);
  const ir = buildIR(r.blocks, r.prose, 'fmtapp');
  const cpp = emitCpp(ir);
  assert.match(cpp, /#include <fmt\/core\.h>/);
  // we don't actually use fmt::print (v12 ABI issues) - just include the header
  assert.match(cpp, /std::cout/);
});

test('emitCpp handles http server for rest kind', () => {
  const r = parseStructured('Application:\n    type: REST API\n\nGET /hello');
  const ir = buildIR(r.blocks, r.prose, 'api');
  const cpp = emitCpp(ir);
  assert.match(cpp, /httplib::Server/);
  // cpp-httplib exposes PascalCase methods (Get, Post, Put, Delete, Patch).
  // the emitter used to call svr.get(...) lowercase which is a compile error.
  assert.match(cpp, /svr\.Get\("\/hello"/);
});

test('emitProject produces CMakeLists with find_package for known deps', () => {
  const r = parseStructured('Require the fmt library.\nRequire the JSON parser library.');
  const ir = buildIR(r.blocks, r.prose, 'demo');
  const p = emitProject(ir, 'demo');
  assert.match(p.cmake, /find_package\(fmt/);
  assert.match(p.cmake, /find_package\(nlohmann_json/);
  assert.deepEqual(JSON.parse(p.vcpkg).dependencies.sort(), ['fmt', 'nlohmann-json']);
});

test('emitProject adds openssl transitive for cpp-httplib', () => {
  const r = parseStructured('Require the HTTP client library.');
  const ir = buildIR(r.blocks, r.prose, 'h');
  const p = emitProject(ir, 'h');
  const deps = JSON.parse(p.vcpkg).dependencies;
  assert.ok(deps.includes('cpp-httplib'));
  assert.ok(deps.includes('openssl'));
});

test('top-level if captures indented body (bug #13)', () => {
  const r = parseStructured('Create a console application.\nif x:\n    print hello\nprint world\n');
  const ir = buildIR(r.blocks, r.prose, 'iftop');
  const cpp = emitCpp(ir);
  // both the if body and the trailing print should land in main()
  assert.match(cpp, /if \(x\)/);
  assert.match(cpp, /std::cout << "hello"/);
  assert.match(cpp, /std::cout << "world"/);
});

test('top-level for each captures indented body (bug #13)', () => {
  const r = parseStructured('Create a console application.\nfor each item in items:\n    print item\nprint done\n');
  const ir = buildIR(r.blocks, r.prose, 'fortop');
  const cpp = emitCpp(ir);
  assert.match(cpp, /for \(auto& item/);
  assert.match(cpp, /std::cout << item/);
  assert.match(cpp, /std::cout << "done"/);
});

test('http_serve honors numeric port (bug: silent 8080 fallback)', () => {
  // the user wrote `serve on port 9090.` and the emitter used to drop
  // the port because isIdent rejects digit-leading strings. accept a
  // plain integer literal too.
  const r = parseStructured('Create a console application.\nserve on port 9090.\n');
  const ir = buildIR(r.blocks, r.prose, 'srv');
  const cpp = emitCpp(ir);
  assert.match(cpp, /svr\.listen\("0\.0\.0\.0", 9090\)/);
});

test('file_write with bare variable emits c++ identifier (bug: string-literal fallback)', () => {
  // the user wrote `file_write out.txt with msg` where msg is a
  // variable. cppLiteral used to stringify the bare token to a
  // quoted literal "msg", losing the variable reference.
  const src = 'Create a console application.\nWhen the program starts:\n    set msg = hello\n    file_write out.txt with msg\n';
  const r = parseStructured(src);
  const ir = buildIR(r.blocks, r.prose, 'f');
  const cpp = emitCpp(ir);
  // should reference the variable, not the string literal
  assert.match(cpp, /_nlpc_out << msg;/);
  assert.doesNotMatch(cpp, /_nlpc_out << "msg";/);
});

test('return with leading string literal passes through as c++ expression', () => {
  // bug: `return "Hello " + name` (concatenation) used to re-quote the
  // whole thing as a string literal because EXPR_RE rejected values
  // starting with a quote. the function returned the literal text
  // `"Hello " + name` instead of the concatenation.
  const src = 'Create a console application.\nMake a function called greet that takes a name and returns a string:\n    return "Hello " + name\n';
  const r = parseStructured(src);
  const ir = buildIR(r.blocks, r.prose, 'g');
  const cpp = emitCpp(ir);
  // should be a c++ expression, not a quoted literal of the whole thing
  assert.match(cpp, /return "Hello " \+ name;/);
  assert.doesNotMatch(cpp, /return "\\"Hello \\" \+ name";/);
});
