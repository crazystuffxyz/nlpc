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

test('print multi-word with no operator emits string literal', () => {
  // bug: `print hello world` (no quotes) used to pass through as
  // a c++ expression and produced `std::cout << hello world << ...`
  // which doesn't compile. treat multi-token values with no operator
  // as a string literal.
  const src = 'Create a console application.\nWhen the program starts:\n    print hello world\n';
  const r = parseStructured(src);
  const ir = buildIR(r.blocks, r.prose, 'p');
  const cpp = emitCpp(ir);
  assert.match(cpp, /std::cout << "hello world"/);
  assert.doesNotMatch(cpp, /std::cout << hello world/);
});

test('for each in main with colon strips colon from source', () => {
  // bug: `for each item in items:` inside main used to capture the
  // trailing colon as part of the source string, producing
  // `for (auto& item : "items:")`. the trailing-colon stripping was
  // only in the top-level handler; parseMainLine's inner regex needed
  // the same fix.
  const src = 'Create a console application.\nWhen the program starts:\n    for each item in items:\n        print item\n';
  const r = parseStructured(src);
  const ir = buildIR(r.blocks, r.prose, 'f');
  const cpp = emitCpp(ir);
  assert.match(cpp, /for \(auto& item : "items"\)/);
  assert.doesNotMatch(cpp, /for \(auto& item : "items:"\)/);
});

test('for each in main captures indented body', () => {
  // bug: indented children of an inner `for` block were being lost
  // because parseBodyLines's child-gather only ran for the very first
  // pass (the main-block children) and the for stmt returned without
  // its body populated.
  const src = 'Create a console application.\nWhen the program starts:\n    for each item in items\n        print item\n        print again\n    print done\n';
  const r = parseStructured(src);
  const ir = buildIR(r.blocks, r.prose, 'f');
  const cpp = emitCpp(ir);
  assert.match(cpp, /for \(auto& item : "items"\)/);
  assert.match(cpp, /std::cout << item/);
  assert.match(cpp, /std::cout << "again"/);
  // done is a sibling, not inside the for
  const forStart = cpp.indexOf('for (auto& item');
  const donePos = cpp.indexOf('"done"');
  assert.ok(forStart > 0 && donePos > forStart, 'done should come after for');
  // done should be after the for's closing brace
  const forEnd = cpp.indexOf('}', forStart);
  assert.ok(donePos > forEnd, 'done should be outside the for loop');
});

test('paren-form params accept rust-style name: type', () => {
  // bug: `(a: int, b: int)` used to be parsed as if the type was the
  // name (`int`) and the name was the type (`a:`). the parser now
  // detects the trailing `:` on the first segment and uses rust-style
  // order.
  const src = 'Create a console application.\nMake a function called add(a: int, b: int) -> int:\n    return a + b\n';
  const r = parseStructured(src);
  const fn = r.blocks.find(b => b.kind === 'function');
  assert.ok(fn);
  assert.equal(fn.params[0].name, 'a');
  assert.equal(fn.params[0].type, 'int');
  assert.equal(fn.params[1].name, 'b');
  assert.equal(fn.params[1].type, 'int');
  const ir = buildIR(r.blocks, r.prose, 'f');
  const cpp = emitCpp(ir);
  assert.match(cpp, /int add\(int a, int b\)/);
  assert.doesNotMatch(cpp, /std::string int/);
});

test('arrow-style return type is recognized', () => {
  // bug: `-> int` was not recognized; returns was null and the emitter
  // defaulted to std::string. the parser now falls back to /-> type/.
  const src = 'Create a console application.\nMake a function called sq(x: int) -> int:\n    return x * x\n';
  const r = parseStructured(src);
  const fn = r.blocks.find(b => b.kind === 'function');
  assert.equal(fn.returns, 'int');
  const ir = buildIR(r.blocks, r.prose, 'f');
  const cpp = emitCpp(ir);
  assert.match(cpp, /int sq\(int x\)/);
});

test('return with unary minus passes through as c++ expression', () => {
  // bug: `return -value` used to re-quote as "-value" because EXPR_RE
  // required the first char to be letter/digit/quote. allow up to two
  // leading `-` so negative literals and unary minus work.
  const src = 'Create a console application.\nMake a function called neg that takes a value and returns an int:\n    return -value\n';
  const r = parseStructured(src);
  const ir = buildIR(r.blocks, r.prose, 'f');
  const cpp = emitCpp(ir);
  assert.match(cpp, /return -value;/);
  assert.doesNotMatch(cpp, /return "-value";/);
});

test('ask noun-phrase uses last word as variable name', () => {
  // bug: `ask the user for their name` used to make a `their_name`
  // variable (slug of the whole phrase) and `ask for age` made
  // `for_age`. the last word of the phrase is the noun and is what
  // the user means.
  const src = 'Create a console application.\nWhen the program starts:\n    ask the user for their name\n    ask for age\n    ask favorite color\n';
  const r = parseStructured(src);
  const ir = buildIR(r.blocks, r.prose, 'p');
  const cpp = emitCpp(ir);
  assert.match(cpp, /std::string name;/);
  assert.match(cpp, /std::string age;/);
  assert.match(cpp, /std::string color;/);
  assert.doesNotMatch(cpp, /std::string their_name/);
  assert.doesNotMatch(cpp, /std::string for_age/);
  assert.doesNotMatch(cpp, /std::string favorite_color/);
});

test('function with no params compiles to no-arg signature', () => {
  // bug: `takes nothing` used to be parsed as a parameter named
  // "nothing" of type "void", producing `void noop(void nothing)`.
  // 'nothing' (and 'no parameters', 'none', 'no', 'args', 'arguments')
  // are filtered as stopwords so params stays empty.
  const src = 'Create a console application.\nMake a function called noop that takes nothing and returns nothing.\n';
  const r = parseStructured(src);
  const fn = r.blocks.find(b => b.kind === 'function');
  assert.deepEqual(fn.params, []);
  assert.equal(fn.returns, 'nothing');
  const ir = buildIR(r.blocks, r.prose, 'f');
  const cpp = emitCpp(ir);
  assert.match(cpp, /void noop\(\)/);
  assert.doesNotMatch(cpp, /void noop\(void/);
});
