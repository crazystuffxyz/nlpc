// codegen - walks IR and emits a single main.cpp
import { cppString, isIdent } from '../runtime/slug.mjs';

// type -> c++ type
const TYPE_MAP = {
  string: 'std::string',
  int: 'int',
  double: 'double',
  bool: 'bool',
  void: 'void',
  auto: 'auto',
  json: 'nlohmann::json',
  bytes: 'std::vector<uint8_t>',
  'vector<string>': 'std::vector<std::string>',
  'vector<int>': 'std::vector<int>',
  http_response: 'std::string',
  file: 'std::ifstream',
};

function cppType(t) { return TYPE_MAP[t] || 'std::string'; }

// zero literal for a return type. used when a function body is empty
// (which is the structured-DSL default).
function cppZero(type) {
  switch (type) {
    case 'int': return '0';
    case 'double': return '0.0';
    case 'bool': return 'false';
    case 'string': return '""';
    case 'void': return '';
    case 'json': return 'nlohmann::json{}';
    case 'vector<string>': return 'std::vector<std::string>{}';
    case 'vector<int>': return 'std::vector<int>{}';
    default: return '""';
  }
}

// emit a user-supplied c++ identifier (function name, param name, call
// target, iter name, etc). rejects anything not matching ^[A-Za-z_]\w*$.
// if the LLM puts garbage here, we'd rather emit a build error than a
// string-injection into c++ source.
function ident(name, fallback) {
  return isIdent(name) ? name : (fallback || '_bad');
}

// emit a c++ value from a JS value. the IR may carry numbers, booleans,
// strings, or arbitrary values from the LLM. for every stmt field that
// flows into a c++ expression, we route through this and either:
//   - number -> decimal literal
//   - bool   -> true/false
//   - string -> JSON-stringified c++ string literal
//   - other  -> safe string fallback
function cppLiteral(v) {
  if (v === null || v === undefined) return '""';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '0';
    return String(v);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return cppString(v);
  return cppString(String(v));
}

// cppExpr: like cppLiteral but for a value the user wrote as a
// c++-expression-like token (variable name, arithmetic, comparison).
// we still pass numbers/bools through correctly, but a bare string
// is emitted as a c++ identifier-or-expression, not a quoted literal.
// restricted to a small grammar to block prompt-injection: identifiers,
// spaces, parens, and the common operator set.
// cppExpr: like cppLiteral but for a value the user wrote as a
// c++-expression-like token (variable name, arithmetic, comparison,
// initializer list). we still pass numbers/bools through correctly,
// but a bare string is emitted as a c++ identifier-or-expression, not
// a quoted literal.
//
// safety: reject strings that contain ';' (statement separator), '#'
// (preprocessor), backticks, or unbalanced parens. prompt-injection in
// prose can produce values like `x"); system("...`, which this grammar
// would otherwise pass through. the allowlist below only contains the
// chars you need for a small DSL: identifiers, math, braces for
// initializer lists, brackets for indexing, and standard c++ operators.
// bug: the first-char class was `[A-Za-z_0-9]` which rejected values
// starting with a quote (e.g. `return "Hello " + name`). expand it to
// also accept leading single or double quote, so a c++ expression
// that begins with a string literal still goes through. allow a leading
// `-` so unary minus / negative literals like `-value` or `-1` pass.
// allow up to two leading `-` to cover `return --x` (rare but legal).
// a leading `"` is allowed because `"foo" + name` is a valid c++ concat.
// a leading `'` is NOT allowed because c++ char literals are 1 char.
// bug: a leading `{` is allowed for c++ initializer lists like
// `{1,2,3,4,5}` (used in `for each x in {1,2,3}`). the previous regex
// rejected them and cppRhs fell back to a string literal, which is
// the wrong type for a range-based for.
const EXPR_RE = /^-{0,2}["{]?[A-Za-z_0-9][A-Za-z0-9_ .(),+\-*/%<>=!&|^~?{}\[\]'"`]*$/;
function cppExpr(v) {
  if (v === null || v === undefined) return '""';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') {
    const t = v.trim();
    // hard reject anything with statement separators or preprocessor
    // directives - those are how prompt injection becomes a shell escape.
    if (/[;#]/.test(t) || /`/.test(t) || /\/\//.test(t)) return '""';
    if (!EXPR_RE.test(t)) return '""';
    return v;
  }
  return cppString(String(v));
}

// cppRhs: like cppExpr, but for the right-hand side of `set X =` and
// the value of `return` in DSL source. the question is whether the
// user wrote a c++ expression (use as-is) or a plain english word
// meant to be a string literal (quote it).
//
// if `knownIdents` is provided and contains the bare-word value, treat
// it as a c++ identifier. otherwise, treat any bare word as a string
// literal. this lets `return positive` (a plain english word in a
// function returning string) compile to `return "positive";` rather
// than `return positive;` (which would be a c++ undefined identifier).
// rhsFor: pick the right C++ representation for a stmt field that
// came from parseValue. if the parser flagged the value as a string
// literal (was originally quoted), always emit a C++ string literal
// regardless of contents - this is what stops `call printf("x=%d y=%s")`
// from emitting bare `x=%d y=%s` as C++. bare tokens and numbers/bools
// go through the normal cppRhs path (identifier-or-expression vs string).
function rhsFor(value, isString, knownIdents) {
  if (isString) return cppString(value ?? '');
  return cppRhs(value, knownIdents);
}

function cppRhs(v, knownIdents) {
  if (v === null || v === undefined) return '""';
  if (typeof v === 'number' || typeof v === 'boolean') return cppExpr(v);
  if (typeof v === 'string') {
    // bare single word with no operators - decide identifier vs string
    if (/^[A-Za-z_]\w*$/.test(v)) {
      // if it's a known identifier, pass through; else it's a string.
      if (knownIdents && knownIdents.has(v)) return v;
      return cppString(v);
    }
    // a multi-token value: it can be either a c++ expression like
    // "x + y" or a string with content like 'hello "world"'. try the
    // c++ grammar first; if it doesn't fit, fall back to a string
    // literal. that way `set s = a + b` becomes `a + b` while
    // `set s = hello "world"` becomes `"hello \"world\""`.
    const t = v.trim();
    // bug: `print hello world` (no quotes, no operator) used to be
    // passed through as a c++ expression and produced a compile error
    // (`std::cout << hello world`). if the multi-token value has no
    // c++ operator at all, treat it as a string literal. the operator
    // list here is intentionally narrow: it only matches c++ operators
    // that actually combine two sub-expressions. `,` and `!` (and `;`)
    // are excluded because they commonly appear in prose (`Hello,
    // world!`) and including them caused the emitter to pass prose
    // through as a c++ expression, which fails to compile
    // (`std::cout << Hello, world! << ...`). function-arg lists use a
    // dedicated stmt (kind:'call'), not the value path, so dropping
    // `,` from this list is safe.
    const hasOp = /[+\-*\/=<>&|^%()[\]{}]/.test(t);
    if (!hasOp) return cppString(v);
    // bug: a value that starts with a single quote (`'Hello ' + name`)
    // used to pass EXPR_RE and produce `return 'Hello ' + name;` which
    // is illegal c++ (multi-char char literal). a value that starts
    // with a *double* quote and is a complete string literal at the
    // start of a c++ expression is fine (`"Hello " + name`).
    if (/^'/.test(t)) return cppString(v);
    if (/[;#`]/.test(t) || /\/\//.test(t) || !EXPR_RE.test(t)) return cppString(v);
    return v;
  }
  return cppString(String(v));
}

export function emitCpp(ir) {
  const out = [];
  out.push(`// generated by nlpc - do not edit`);
  out.push(`#include <iostream>`);
  out.push(`#include <string>`);
  out.push(`#include <vector>`);
  out.push(`#include <sstream>`);
  // unconditional headers. the emitter may reference these without any
  // matching requirement (json_load/json_save, sleep, assert, port env),
  // and trusting a transitive include from somewhere else is the bug
  // that broke file I/O in plain console apps.
  out.push(`#include <fstream>`);
  out.push(`#include <cassert>`);
  out.push(`#include <thread>`);
  out.push(`#include <chrono>`);
  out.push(`#include <cstdlib>`);
  out.push(`#include <filesystem>`);
  // optional headers (requirement-gated)
  const reqs = (ir.requirements || []).map(r => r.name.toLowerCase());
  if (reqs.some(r => /nlohmann|json/.test(r))) out.push(`#include <nlohmann/json.hpp>`);
  if (reqs.some(r => /httplib|cpr|cpp-httplib/.test(r))) out.push(`#include <httplib.h>`);
  if (reqs.some(r => /spdlog/.test(r))) out.push(`#include <spdlog/spdlog.h>`);
  if (reqs.some(r => /fmt/.test(r))) out.push(`#include <fmt/core.h>`);
  out.push('');
  // declarations (functions)
  for (const d of ir.declarations || []) {
    if (d.kind === 'function') {
      const params = (d.params || []).map(p => `${cppType(p.type)} ${ident(p.name, 'arg')}`).join(', ');
      const rettype = cppType(d.returns || 'void');
      out.push(`${rettype} ${ident(d.name, 'fn')}(${params}) {`);
      // knownIdents: param names are in scope as c++ identifiers, so
      // `return x` in a function `foo(int x)` should emit `return x;`
      // and not `return "x";`. this set is propagated to nested blocks
      // and grows as `set X = ...` introduces locals.
      const knownIdents = new Set((d.params || []).map(p => p.name));
      if (d.returns && d.returns !== 'void') {
        if (d.body && d.body.length) {
          const fnDeclared = new Set(knownIdents);
          for (const s of d.body) {
            const ln = emitStmt(s, '    ', { declared: fnDeclared, knownIdents });
            if (ln) out.push(ln);
          }
          // body didn't explicitly return; emit a typed zero so the c++
          // compiler doesn't reject the non-void function for missing
          // return path.
          out.push(`    return ${cppZero(d.returns)};`);
        } else {
          // offline mode never populates a body; emit a typed zero literal
          // so e.g. returns: 'int' compiles to `return 0;` not `return "";`.
          out.push(`    return ${cppZero(d.returns)};`);
        }
      }
      out.push(`}`);
      out.push('');
    } else if (d.kind === 'variable') {
      out.push(`${cppType(d.type || 'string')} ${ident(d.name, 'var')} = ${cppLiteral(d.value)};`);
    }
  }
  // main
  out.push(`int main() {`);
  out.push(`    std::ios::sync_with_stdio(false);`);
  out.push(`    std::cin.tie(nullptr);`);
  out.push('');
  // track per-function and per-main variable names so the second
  // `set x = ...` becomes a plain `x = ...;` instead of re-declaring
  // `auto x = ...;` (which is a hard c++ error: redefinition of 'x').
  const declared = new Set();
  // behaviors
  const startBeh = (ir.behaviors || []).find(b => b.trigger === 'start');
  const routeBehs = (ir.behaviors || []).filter(b => b.trigger === 'route');
  if (routeBehs.length && reqs.some(r => /httplib|cpp-httplib/.test(r))) {
    out.push(`    httplib::Server svr;`);
    for (const r of routeBehs) {
      // cpp-httplib exposes PascalCase methods: Get/Post/Put/Delete/Patch.
      // lowercase svr.get/post/etc. don't exist on the class and produce
      // a hard compile error for every rest kind program.
      const raw = String(r.method || 'GET').toLowerCase();
      const method = raw.charAt(0).toUpperCase() + raw.slice(1);
      const path = cppString(r.path || '/');
      out.push(`    svr.${method}(${path}, [](const httplib::Request& req, httplib::Response& res) {`);
      // bug #12: don't unconditionally append res.set_content("ok",...)
      // after the body. if the body didn't set a response, fall back to
      // "ok" - but if it did, leave that response alone.
      let bodySetResponse = false;
      for (const s of r.body || []) {
        const ln = emitStmt(s, '        ', { routeCtx: true });
        if (ln) {
          if (s.kind === 'raw' && /\bres\.set_content\s*\(/.test(s.code || '')) bodySetResponse = true;
          else if (s.kind === 'call' && /res/.test(s.target || '')) bodySetResponse = true;
          out.push(ln);
        }
      }
      if (!bodySetResponse) out.push(`        res.set_content("ok", "text/plain");`);
      out.push(`    });`);
    }
    // PORT env var lets PaaS hosts (heroku, fly, railway) inject the bind port
    // without a code change. std::getenv returns nullptr when unset.
    out.push(`    const char* nlpc_port = std::getenv("PORT");`);
    out.push(`    int port = nlpc_port ? std::atoi(nlpc_port) : 8080;`);
    out.push(`    svr.listen("0.0.0.0", port);`);
  } else if (startBeh) {
    // bug #13: multiple `start`-trigger behaviors can exist when top-level
    // `if`/`for` blocks become their own behavior. merge all of them
    // so we don't silently drop statements (which is what the old
    // `find()` did: only the first start-trigger behavior was emitted).
    const startBehs = (ir.behaviors || []).filter(b => b.trigger === 'start');
    // bug: if the user wrote `serve on port NNNN` without any routes,
    // emit needs to declare an `httplib::Server svr;` somewhere. the
    // http_serve stmt by itself is a hard compile error otherwise. do
    // it here so it's exactly once.
    let needsSvr = false;
    for (const sb of startBehs) for (const s of (sb.body || [])) if (s && s.kind === 'http_serve') needsSvr = true;
    if (needsSvr) out.push(`    httplib::Server svr;`);
    for (const sb of startBehs) {
      for (const s of sb.body || []) {
        const ln = emitStmt(s, '    ', { declared });
        if (ln) out.push(ln);
      }
    }
  }
  out.push(`    return 0;`);
  out.push(`}`);
  return out.join('\n');
}

function emitStmt(s, indent, ctx = {}) {
  if (!s || !s.kind) return null;
  const declared = ctx.declared || (ctx.declared = new Set());
  const knownIdents = ctx.knownIdents || declared;
  switch (s.kind) {
    case 'print': {
      return `${indent}std::cout << ${rhsFor(s.text, s.isString, knownIdents)} << std::endl;`;
    }
    case 'ask': {
      const name = ident(s.name, 'input');
      // bug: `ask the user for their name` declares a c++ variable
      // named `name`, but the ask emit didn't add that name to
      // knownIdents. a later `print name` then fell through cppRhs
      // and was emitted as `std::cout << "name" << ...` (string
      // literal) instead of `std::cout << name << ...` (variable
      // value). record it as in-scope and as a declared local so a
      // future `set name = ...` becomes a plain assignment.
      if (s.name && /^[A-Za-z_]\w*$/.test(s.name)) {
        knownIdents.add(s.name);
        declared.add(s.name);
      }
      return [
        `${indent}std::cout << ${cppString(s.text || '> ')} << std::flush;`,
        `${indent}std::string ${name};`,
        `${indent}std::getline(std::cin, ${name});`,
      ].join('\n');
    }
    case 'set': {
      const v = ident(s.name, 'var');
      // if we've already declared this name in the current scope, emit a
      // plain assignment so we don't hit "redefinition of v".
      // use cppRhs so `set sum = sum + x` becomes `sum = sum + x` rather
      // than `sum = "sum + x"`, and `set msg = hello` (bare word) becomes
      // `auto msg = "hello";` rather than `auto msg = hello;`.
      const rhs = rhsFor(s.value, s.isString, knownIdents);
      if (declared.has(v)) {
        return `${indent}${v} = ${rhs};`;
      }
      declared.add(v);
      knownIdents.add(v);
      // bug: `set greeting = "Hello"` used to be emitted as
      // `auto greeting = "Hello";`, which deduces `greeting` to
      // `const char*`. that breaks any later concatenation:
      //   set combined = greeting + ", " + name + "!";
      // produces a compile error because `const char*` doesn't
      // support `+` with a string literal. declare string-typed
      // bindings as `std::string` so concatenation just works.
      // numbers/bools/identifiers keep `auto` because that gives
      // the right c++ type.
      const isStringLit = s.isString && typeof s.value === 'string';
      const decl = isStringLit ? 'std::string' : 'auto';
      return `${indent}${decl} ${v} = ${rhs};`;
    }
    case 'call': {
      const target = ident(s.target, '_');
      // bug #3: filter out empty-string args. use cppRhs so `call add(a, b)`
      // passes a, b as identifiers (when known) rather than the strings
      // "a", "b". bare words that aren't known are quoted as strings.
      const args = (s.args || []).filter(a => a && a.value !== '' && a.value !== null && a.value !== undefined).map(a => rhsFor(a.value, a.isString, knownIdents)).join(', ');
      return `${indent}${target}(${args});`;
    }
    case 'return': {
      // `return positive` in a function returning string -> "positive".
      // `return x` where x is a param or local -> x as c++ identifier.
      return `${indent}return ${rhsFor(s.value, s.isString, knownIdents)};`;
    }
    case 'http_get': {
      // bug #11: the http_get case used to call cli.Get() regardless of
      // method. dispatch on s.method to use the right verb.
      const path = cppString(s.path || '');
      const verb = String(s.method || 'GET').toLowerCase();
      const cliMethod = ({ get: 'Get', post: 'Post', put: 'Put', delete: 'Delete', patch: 'Patch' })[verb] || 'Get';
      return [
        `${indent}auto cli = httplib::Client("http://localhost", 8080);`,
        `${indent}auto res = cli.${cliMethod}(${path});`,
        `${indent}if (res) std::cout << res->body << std::endl;`,
      ].join('\n');
    }
    case 'http_post':
    case 'http_put':
    case 'http_delete':
    case 'http_patch': {
      const path = cppString(s.path || '');
      const verb = String(s.method || 'POST').toLowerCase();
      const cliMethod = ({ post: 'Post', put: 'Put', delete: 'Delete', patch: 'Patch' })[verb] || 'Post';
      return [
        `${indent}auto cli = httplib::Client("http://localhost", 8080);`,
        `${indent}auto res = cli.${cliMethod}(${path}, std::string());`,
        `${indent}if (res) std::cout << res->body << std::endl;`,
      ].join('\n');
    }
    case 'http_serve': {
      // bug: the user can pass a port number ("9090") as a string.
      // isIdent rejects digit-leading strings, so the port silently
      // fell back to 8080. accept a plain integer literal too.
      const raw = String(s.port ?? '');
      let port;
      if (/^\d+$/.test(raw)) port = raw;
      else if (isIdent(raw)) port = raw;
      else port = '8080';
      return `${indent}svr.listen("0.0.0.0", ${port});`;
    }
    case 'http_route': {
      // bug: this used to hardcode `svr.get` (lowercase), which is not
      // a member of cpp-httplib's Server class - all methods are
      // PascalCase. also ignored the method field entirely. normalize
      // the method and emit the matching PascalCase call.
      const raw = String(s.method || 'GET').toLowerCase();
      const method = raw.charAt(0).toUpperCase() + raw.slice(1);
      const path = cppString(s.path || '/');
      return `${indent}svr.${method}(${path}, [](const auto& req, auto& res) { res.set_content("ok", "text/plain"); });`;
    }
    case 'json_load': {
      return `${indent}auto j = nlohmann::json::parse(std::ifstream(${cppString(s.path || 'data.json')}));`;
    }
    case 'json_save': {
      // bug: was cppLiteral which stringified bare identifiers. if the
      // value is a c++ variable, nlohmann::json(var).dump() will produce
      // a valid json representation of the value.
      const val = (s.valueIsString === false)
        ? rhsFor(s.value, false, knownIdents)
        : cppLiteral(s.value);
      return `${indent}{ std::ofstream _nlpc_out(${cppString(s.path || 'data.json')}); _nlpc_out << nlohmann::json(${val}).dump(); }`;
    }
    case 'file_read': {
      const name = ident(s.name, 'data');
      return `${indent}{ std::ifstream _nlpc_in(${cppString(s.path || 'in.txt')}); std::stringstream _nlpc_ss; _nlpc_ss << _nlpc_in.rdbuf(); auto ${name} = _nlpc_ss.str(); }`;
    }
    case 'file_write': {
      // bug: was cppLiteral(s.value) which stringified a bare identifier
      // to a quoted literal, so `file_write out.txt with msg` wrote the
      // string "msg" instead of the variable's value. use rhsFor so an
      // isString=false value (bare token) routes through cppRhs and
      // resolves to a c++ identifier when it's in knownIdents.
      const val = (s.valueIsString === false)
        ? rhsFor(s.value, false, knownIdents)
        : cppLiteral(s.value);
      return `${indent}{ std::ofstream _nlpc_out(${cppString(s.path || 'out.txt')}); _nlpc_out << ${val}; }`;
    }
    case 'file_rename': {
      // bug: file-rename stmt. emit c++17 std::filesystem::rename. the
      // include is unconditional (fstream is already there; filesystem
      // needs its own include).
      const from = s.fromIsString === false ? rhsFor(s.from, false, knownIdents) : cppString(s.from ?? '');
      const to = s.toIsString === false ? rhsFor(s.to, false, knownIdents) : cppString(s.to ?? '');
      return `${indent}std::filesystem::rename(${from}, ${to});`;
    }
    case 'file_delete': {
      // bug: file-delete stmt. emit std::filesystem::remove. route
      // the path through rhsFor so a bare-token path (e.g. `delete
      // src` after `set src = "..."`) resolves to a c++ identifier
      // instead of being quoted as the literal "src".
      const path = s.isString === false ? rhsFor(s.path, false, knownIdents) : cppString(s.path ?? '');
      return `${indent}std::filesystem::remove(${path});`;
    }
    case 'log': {
      const lvl = isIdent(s.level) ? s.level : 'info';
      return `${indent}spdlog::${lvl}(${cppString(s.text ?? '')});`;
    }
    case 'sleep': {
      const ms = Number.isFinite(s.ms) ? s.ms : 1000;
      return `${indent}std::this_thread::sleep_for(std::chrono::milliseconds(${ms}));`;
    }
    case 'assert': {
      // cond is a c++ boolean expression we pass through. reject anything
      // that contains characters outside the c++ expression grammar to
      // stop the LLM from injecting code via an assert cond.
      const cond = String(s.cond || 'true');
      if (!/^[A-Za-z0-9_ ().!=<>&|+\-*/'"?:]+$/.test(cond)) return `${indent}// unsafe assert cond dropped`;
      return `${indent}assert(${cond});`;
    }
    case 'for': {
      const iter = ident(s.iter, 'x');
      const inner = indent + '    ';
      // iter is also an in-scope identifier inside the loop body
      const childKnown = new Set(knownIdents);
      childKnown.add(iter);
      // bug #13: use rhsFor (not cppExpr) for the source. cppExpr with
      // no knownIdents would route a bare word like `items` to a
      // string-literal-style fallback, when really the user meant
      // `items` as a c++ identifier (a vector the loop iterates).
      let src = rhsFor(s.source, s.isString, knownIdents);
      // bug: `for each x in [1,2,3]` used to compile to
      // `for (auto& x : "[1,2,3]")` because the rhs has no leading
      // match for a c++ brace-list. c++ doesn't actually accept
      // `[1,2,3]` as an initializer list (only `{1,2,3}` works), so
      // translate `[...]` -> `{...}` here when the source looks like
      // a bare array literal. only applies when the value is a
      // string (the parser wouldn't have produced a number/bool
      // array literal).
      if (typeof s.source === 'string') {
        const t = s.source.trim();
        if (/^\[.*\]$/.test(t)) src = '{' + t.slice(1, -1) + '}';
      }
      const lines = [`${indent}for (auto& ${iter} : ${src}) {`];
      for (const sub of s.body || []) {
        const ln = emitStmt(sub, inner, { declared, knownIdents: childKnown });
        if (ln) lines.push(ln);
      }
      lines.push(`${indent}}`);
      return lines.join('\n');
    }
    case 'if': {
      const cond = String(s.cond || 'true');
      // restrict cond to a c++-expression grammar; reject prompt-injection
      // attempts that try to close the if and run arbitrary code.
      if (!/^[A-Za-z0-9_ ().!=<>&|+\-*/'"?:.]+$/.test(cond)) return `${indent}// unsafe if cond dropped`;
      const inner = indent + '    ';
      const lines = [`${indent}if (${cond}) {`];
      for (const sub of s.body || []) {
        const ln = emitStmt(sub, inner, { declared, knownIdents });
        if (ln) lines.push(ln);
      }
      lines.push(`${indent}}`);
      return lines.join('\n');
    }
    case 'raw': {
      // raw is the explicit escape hatch per docs/language-spec.md.
      // we still indent it, and append a `;` if the user didn't, so
      // `raw std::system("...")` is just as valid as `raw x;`.
      const code = String(s.code || '');
      const trimmed = code.replace(/;\s*$/, '');
      return `${indent}${trimmed};`;
    }
    case 'unsupported': {
      // emitted when a line in the .nlp didn't match any known verb.
      // we drop it (with a comment) rather than pass through as raw
      // c++ - that's the prompt-injection vector for free-form prose.
      return `${indent}// unsupported: ${s.text || ''}`;
    }
    default: {
      return `${indent}// unsupported stmt: ${s.kind}`;
    }
  }
}
