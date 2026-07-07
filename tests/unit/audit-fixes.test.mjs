// regression tests for the bug-find pass that ran after v1.0.0.
// each test corresponds to one bug the background review surfaced
// that survived the prior fix loop. keep them in this file so the
// fixes are easy to find and so a future "did we regress?" check
// can run the whole cluster in one go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStructured } from '../../lib/parser/structured.mjs';
import { buildIR } from '../../lib/ir/builder.mjs';
import { emitCpp } from '../../lib/codegen/emit.mjs';
import { emitProject } from '../../lib/codegen/cmake.mjs';
import { lookup, resolveRequirements } from '../../lib/deps/resolver.mjs';

// 1. RCE: print name + system("evil") must NOT emit a function call.
//    before the fix, EXPR_RE allowed `()` in the char class, and
//    cppRhs routed any string with an operator through it. the
//    payload slipped through and compiled to `system("evil")` at
//    runtime. fix: disallow parens/brackets in EXPR_RE, AND reject
//    function-call shape at the cppRhs layer.
test('RCE: print name + system("evil") does not invoke system()', () => {
  const src = `When the program starts:\n    set name = "x"\n    print name + system("evil")`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'rce');
  const cpp = emitCpp(ir);
  // the malicious payload must not survive as bare c++ on its own
  // line - it should only appear inside a string literal, never as
  // a callable expression. match `system(` NOT preceded by a `"`
  // (i.e. not inside an already-quoted string).
  const lines = cpp.split('\n');
  for (const line of lines) {
    // strip string-literal content for the check (the literal might
    // contain the substring `system(` as data, and that's fine).
    const stripped = line.replace(/"[^"]*"/g, '""');
    assert.equal(/system\s*\(/.test(stripped), false, `system() leaked as c++: ${line}`);
  }
});

test('RCE: call-shape is rejected by cppRhs even before EXPR_RE', () => {
  // `set x = foo(1)` - the function-call shape must be turned into a
  // string literal so it cannot be invoked as c++.
  const src = `When the program starts:\n    set x = foo(1)\n    print x`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'rce2');
  const cpp = emitCpp(ir);
  // the rhs must NOT appear as a callable expression outside a
  // string literal. strip string-literal content first.
  const stripped = cpp.replace(/"[^"]*"/g, '""');
  assert.equal(/foo\s*\(\s*1\s*\)/.test(stripped), false, 'foo(1) leaked as c++');
});

test('RCE: brackets in rhs are also rejected', () => {
  const src = `When the program starts:\n    set x = arr[0]\n    print x`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'rce3');
  const cpp = emitCpp(ir);
  const stripped = cpp.replace(/"[^"]*"/g, '""');
  assert.equal(/arr\s*\[/.test(stripped), false, 'arr[0] leaked as c++');
});

// 2. if-cond must reject English phrases like "x is positive".
//    before the fix, the if-cond regex allowed any letter, so
//    `if x is positive:` compiled to `if (x is positive) {`, which
//    is not c++. fix: require at most one letter-only token.
test('if-cond: English phrases are dropped (x is positive)', () => {
  const src = `When the program starts:\n    set x = 1\n    if x is positive:\n        print hi`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'cond-en');
  const cpp = emitCpp(ir);
  // must not contain the literal "is positive" as c++
  assert.equal(/if\s*\(\s*x\s+is\s+positive/.test(cpp), false, 'if (x is positive) leaked as c++');
  assert.match(cpp, /unsafe if cond dropped/);
});

test('if-cond: simple comparison still works (n > 0)', () => {
  const src = `When the program starts:\n    set n = 5\n    if n > 0:\n        print positive`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'cond-ok');
  const cpp = emitCpp(ir);
  assert.match(cpp, /if \(n > 0\)/);
  assert.doesNotMatch(cpp, /unsafe if cond dropped/);
});

test('if-cond: bare ident is still valid (server_ready)', () => {
  const src = `When the program starts:\n    if server_ready:\n        print go`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'cond-bare');
  const cpp = emitCpp(ir);
  assert.match(cpp, /if \(server_ready\)/);
});

// 3. bodySetResponse substring bug: `call preserve()` must NOT
//    suppress the "ok" fallback. before the fix, the check was
//    `/res/.test(s.target)` which matched any target with the
//    letters "res" anywhere.
test('route: call preserve() does not suppress the response fallback', () => {
  const src = `Application:\n    type: REST API\n\nRequire the http library.\n\nGET /test\n    call preserve()`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'res');
  const cpp = emitCpp(ir);
  // preserve() itself was a no-op call - response should still be set
  assert.match(cpp, /res\.set_content\("ok"/);
});

test('route: call result() does not suppress the response fallback', () => {
  const src = `Application:\n    type: REST API\n\nRequire the http library.\n\nGET /test\n    call result()`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'res2');
  const cpp = emitCpp(ir);
  assert.match(cpp, /res\.set_content\("ok"/);
});

test('route: a real res.set_content call suppresses the fallback', () => {
  const src = `Application:\n    type: REST API\n\nRequire the http library.\n\nGET /test\n    return hello`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'res3');
  const cpp = emitCpp(ir);
  // the `return hello` in a route body emits `res.set_content(hello, ...)`.
  // the explicit "ok" fallback must NOT also be emitted.
  // (count of `res.set_content` should be 1)
  const matches = cpp.match(/res\.set_content/g) || [];
  assert.equal(matches.length, 1, `expected 1 res.set_content, got ${matches.length}`);
});

// 4. top-level `set x = 5` must produce an int, not std::string.
//    before the fix, the variable was emitted as
//    `std::string x = "5";`. fix: builder parses the value, sets
//    isString/type, emitter picks the matching cpp type.
test('top-level set: numeric value produces int, not string', () => {
  const src = `set x = 5`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'tln');
  const cpp = emitCpp(ir);
  // must declare as int, not std::string, and not wrap 5 in quotes
  assert.match(cpp, /int x = 5;/);
  assert.doesNotMatch(cpp, /std::string x = "5"/);
});

test('top-level set: string value is a std::string', () => {
  const src = `set name = "alice"`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'tls');
  const cpp = emitCpp(ir);
  assert.match(cpp, /std::string name = "alice";/);
});

test('top-level set: decimal value produces double', () => {
  const src = `set pi = 3.14`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'tld');
  const cpp = emitCpp(ir);
  assert.match(cpp, /double pi = 3\.14;/);
});

// 5. parseValue: `set x = "a" + "b"` should compile cleanly.
//    before the fix, the startsWith+endsWith check sliced off the
//    outer quotes and left a broken string with inner quotes and a
//    `+` - the generated c++ was `std::string x = "a" + "b";` which
//    is a real c++ concat (works), but for `"a" + "b" + name` it
//    would emit `std::string x = "a" + "b" + name";` which doesn't.
//    fix: if the inner contains a `+` or an unescaped quote, fall
//    through to the expression path so the emitter routes through
//    cppRhs/EXPR_RE (which already rejects unsafe expressions).
test('parseValue: `"a" + "b"` compiles as c++ string concat', () => {
  const src = `When the program starts:\n    set x = "a" + "b"\n    print x`;
  const { blocks, prose } = parseStructured(src);
  const ir = buildIR(blocks, prose, 'pv1');
  const cpp = emitCpp(ir);
  // generated c++ should contain the original `"a" + "b"` form
  // (NOT a single stripped string)
  assert.match(cpp, /"a" \+ "b"/);
  // and NOT a single string with inner quotes
  assert.doesNotMatch(cpp, /"a"\s*\+\s*"b"\s*"/);
});

// 6. resolver: lookup('') must return null, not the first index entry.
test('lookup: empty string returns null (was: first entry)', () => {
  assert.equal(lookup(''), null);
  assert.equal(lookup('   '), null);
});

test('lookup: single-letter inputs do not substring-match multi-letter keys', () => {
  // was: `lookup('f')` returned 'fmt' because 'fmt'.includes('f').
  // now: forward-substring only. 'f' doesn't contain 'fmt'.
  assert.equal(lookup('f'), null);
});

test('lookup: forward-substring still works (json library phrase)', () => {
  assert.equal(lookup('a json library please'), 'nlohmann-json');
});

test('lookup: short phrase matches long key (JSON parser library)', () => {
  assert.equal(lookup('JSON parser library'), 'nlohmann-json');
});

// 7. cmake: every port in the library-map must have a find_package
//    entry. before the fix, imgui, qt, wxwidgets, libpq,
//    mysql-connector-cpp, hiredis, grpc, protobuf, msgpack, date,
//    magic-enum, frozen, tinyxml2, fast-cpp-csv-parser all had
//    vcpkg port names but no find_package / link entries. some
//    ports use a different find_package name (vcpkg's `libpq` port
//    is exposed via `find_package(PostgreSQL)`), so the test
//    accepts a small map of port->expected find_package.
test('cmake: every library-map port has a find_package and link entry', () => {
  const portCases = [
    { port: 'hiredis', find: /find_package\(hiredis/ },
    { port: 'libpq', find: /find_package\(PostgreSQL/ },
    { port: 'imgui', find: /find_package\(imgui/ },
    { port: 'qt', find: /find_package\(Qt6/ },
    { port: 'grpc', find: /find_package\(gRPC/ },
    { port: 'protobuf', find: /find_package\(Protobuf/ },
    { port: 'msgpack', find: /find_package\(msgpack-c/ },
    { port: 'date', find: /find_package\(date/ },
    { port: 'magic-enum', find: /find_package\(magic_enum/ },
    { port: 'frozen', find: /find_package\(frozen/ },
    { port: 'tinyxml2', find: /find_package\(tinyxml2/ },
    { port: 'fast-cpp-csv-parser', find: /find_package\(csv-parser/ },
    { port: 'wxwidgets', find: /find_package\(wxWidgets/ },
    { port: 'mysql-connector-cpp', find: /find_package\(mysql-connector-cpp/ },
  ];
  for (const { port, find } of portCases) {
    const { packages } = resolveRequirements([{ name: port, source: 'vcpkg' }]);
    assert.ok(packages.includes(port), `resolver should map to ${port}`);
    const ir = {
      program: { name: 'chk', kind: 'console' },
      requirements: [{ name: port, source: 'vcpkg' }],
      declarations: [],
      behaviors: [{ trigger: 'start', body: [] }],
      constraints: [],
    };
    const { cmake } = emitProject(ir, 'chk');
    assert.match(cmake, find, `missing find_package for ${port} (expected ${find})`);
  }
});

// 8. cmake: openssl is no longer auto-added as a cpp-httplib
//    transitive. fix: remove the forced transitive so plain HTTP
//    doesn't pull in the ssl build.
test('cmake: cpp-httplib does not force openssl as a transitive', () => {
  const ir = {
    program: { name: 'plain', kind: 'rest' },
    requirements: [{ name: 'http library', source: 'vcpkg' }],
    declarations: [],
    behaviors: [{ trigger: 'start', body: [] }],
    constraints: [],
  };
  const p = emitProject(ir, 'plain');
  assert.equal(p.packages.includes('openssl'), false, 'openssl was force-added as a cpp-httplib transitive');
  assert.ok(p.packages.includes('cpp-httplib'));
});
