// ir builder - structured blocks -> ir (no llm path)
import { validateIR } from './validator.mjs';
import { slug } from '../runtime/slug.mjs';

export function buildIR(blocks, prose = [], programName = null) {
  const ir = {
    program: { name: programName ? slug(programName) : 'app', kind: 'console', entry: 'main' },
    requirements: [],
    declarations: [],
    behaviors: [],
    constraints: [{ kind: 'cxx_standard', value: '20' }],
  };
  const seenReq = new Set();
  const require = (name) => {
    const key = String(name).toLowerCase();
    if (!seenReq.has(key)) { seenReq.add(key); ir.requirements.push({ name, source: 'vcpkg' }); }
  };
  let usesSpdlog = false;
  let usesJson = false;
  const visit = (body) => {
    for (const s of body || []) {
      if (s.kind === 'log') usesSpdlog = true;
      if (s.kind === 'json_load' || s.kind === 'json_save') usesJson = true;
      if (s.body) visit(s.body);
    }
  };
  for (const b of blocks) {
    if (b.kind === 'require') {
      require(b.name);
    } else if (b.kind === 'application') {
      ir.program.kind = b.type || 'console';
    } else if (b.kind === 'app_field' && b.value) {
      const t = b.value.toLowerCase();
      if (t.includes('rest') || t.includes('api')) ir.program.kind = 'rest';
      else if (t.includes('window') || t.includes('gui')) ir.program.kind = 'window';
      else if (t.includes('console') || t.includes('cli')) ir.program.kind = 'console';
    } else if (b.kind === 'function') {
      // bug #6: params is now [{name,type?}, ...] not bare strings.
      // honor the explicit type from the paren-form parser; fall back to
      // guessType on the name (and finally 'string') for the natural-
      // language form where no type was given.
      const fnParams = (b.params || []).map(p => {
        if (typeof p === 'string') return { name: slug(p), type: guessType(p) };
        return { name: slug(p.name), type: p.type ? guessType(p.type) : guessType(p.name) };
      });
      // pass param names through to the body parser so `return x` can
      // resolve `x` as the parameter rather than a string literal.
      const knownIdents = new Set(fnParams.map(p => p.name));
      const bodyLines = (b.body || []).slice();
      bodyLines.__knownIdents = knownIdents;
      const fn = {
        kind: 'function',
        name: slug(b.name),
        params: fnParams,
        returns: b.returns ? guessType(b.returns) : 'string',
        body: parseBodyLines(bodyLines),
      };
      ir.declarations.push(fn);
      // a function body that calls or returns a log stmt means we need spdlog
      visit(fn.body);
    } else if (b.kind === 'main') {
      const beh = { trigger: 'start', body: parseBodyLines(b.body) };
      visit(beh.body);
      ir.behaviors.push(beh);
    } else if (b.kind === 'print') {
      const v = parseValue(b.m[0]);
      ir.behaviors.push({ trigger: 'start', body: [{ kind: 'print', text: v.value, isString: v.isString }] });
    } else if (b.kind === 'ask') {
      const v = parseValue(b.m[0]);
      // bug: variable name was a slug of the whole phrase ("ask for
      // age" -> "for_age"). use the last word as the noun instead.
      const words = String(b.m[0] || '').trim().split(/\s+/).filter(Boolean);
      const noun = words[words.length - 1] || b.m[0];
      ir.behaviors.push({ trigger: 'start', body: [{ kind: 'ask', text: v.value, isString: v.isString, name: slug(noun) }] });
    } else if (b.kind === 'http_serve') {
      ir.behaviors.push({ trigger: 'start', body: [{ kind: 'http_serve', port: b.port }] });
    } else if (b.kind === 'route') {
      // bug #10/#11: when the structured DSL sees "GET /foo" at the top
      // level, lower it to a route behavior with the real method. bug
      // #11: when it's inside main, parseMainLine also dispatches by
      // method - don't bake the wrong verb into the stmt kind.
      // parse the route body through parseBodyLines so inline stmts land
      // inside the handler closure. use a fresh knownIdents set scoped
      // to the handler.
      const routeBody = (b.body || []).slice();
      routeBody.__knownIdents = new Set();
      ir.behaviors.push({ trigger: 'route', method: b.method, path: b.path, body: parseBodyLines(routeBody) });
    } else if (b.kind === 'set') {
      // bug: `set class = 5` or `set int = 1` would lower to
      // `auto class = 5;` / `auto int = 1;`, which c++ rejects
      // because `class` and `int` are reserved words. slug() now
      // appends `_n` to reserved words, so the variable compiles as
      // `auto class_n = 5;`. the value side doesn't need slugging -
      // it goes through parseValue which handles strings/numbers.
      ir.declarations.push({ kind: 'variable', name: slug(b.m[0]), value: b.m[1] });
    } else if (b.kind === 'if') {
      // bug #13: top-level `if X:` block (captured with body in
      // structured.mjs). lower to a behavior whose body is one `if`
      // stmt, with its body parsed through parseBodyLines.
      const ifBody = (b.body || []).slice();
      ifBody.__knownIdents = new Set();
      const ifStmt = { kind: 'if', cond: (b.m && b.m[0]) || '', body: parseBodyLines(ifBody) };
      const beh = { trigger: 'start', body: [ifStmt] };
      visit(beh.body);
      ir.behaviors.push(beh);
    } else if (b.kind === 'loop' || b.kind === 'for') {
      // top-level `for each X in Y:` block (or any of the loop synonyms).
      // bug #6/#13: the structured.mjs `loop` regex captured "X in Y:"
      // as one group. re-parse here so we get the iter name and the
      // source separately, with the trailing colon stripped.
      const raw = b.raw || '';
      const m = raw.match(/^for\s+each\s+(\w+)\s+in\s+(.+?)\s*[.:]?\s*$/i)
        || raw.match(/^(?:loop|repeat|iterate)\s+(\w+)\s+in\s+(.+?)\s*[.:]?\s*$/i);
      if (m) {
        const v = parseValue(m[2]);
        // bug: `for each class in items:` would lower to
        // `for (auto& class : items)` which is a c++ parse error.
        // slug the iter name the same way we slug `set` names.
        const stmt = { kind: 'for', iter: slug(m[1]), source: v.value, isString: v.isString, body: [] };
        const body = (b.body || []).slice();
        body.__knownIdents = new Set([stmt.iter]);
        stmt.body = parseBodyLines(body);
        const beh = { trigger: 'start', body: [stmt] };
        visit(beh.body);
        ir.behaviors.push(beh);
      }
    }
  }
  if (ir.program.kind === 'rest') {
    if (!ir.requirements.find(r => /httplib|cpr/i.test(r.name))) {
      require('cpp-httplib');
    }
  }
  // bug #17: a log stmt emits spdlog::...() but the structured parser may
  // never have added spdlog to requirements. force-add it so the link
  // line in CMakeLists.txt exists and the include is present.
  if (usesSpdlog) require('spdlog');
  // json_load/json_save use nlohmann::json. the include is gated on the
  // dep name in the emitter, so the dep has to be present.
  if (usesJson) require('nlohmann-json');
  // http_serve emits `svr.listen(...)` which requires cpp-httplib. the user
  // may not have written `Create a rest application` or `Require the http
  // library`, so the include and the Server declaration would otherwise
  // be missing. force-add the dep and force-construct an svr if a
  // http_serve stmt appears without a rest kind.
  let usesHttpServe = false;
  for (const b of (ir.behaviors || [])) {
    for (const s of (b.body || [])) if (s && s.kind === 'http_serve') usesHttpServe = true;
  }
  if (usesHttpServe) require('cpp-httplib');
  // sanity: if we got here from pure prose with no structured blocks, the ir is empty
  if (ir.behaviors.length === 0 && ir.declarations.length === 0 && blocks.length === 0) {
    const err = new Error('ir empty: no structured blocks and no behaviors/declarations; LLM is required to interpret free-form prose');
    err.code = 'IR_EMPTY';
    throw err;
  }
  const v = validateIR(ir);
  if (!v.ok) {
    const err = new Error('ir invalid: ' + v.errors.map(e => `${e.path} ${e.msg}`).join('; '));
    err.errors = v.errors;
    throw err;
  }
  return ir;
}

function guessType(s) {
  const t = String(s).toLowerCase().trim();
  if (t.includes('list of string') || t === 'list of strings' || t === 'strings' || t === 'vector<string>') return 'vector<string>';
  if (t.includes('list') || t.includes('array') || t.includes('vector')) {
    if (t.includes('string')) return 'vector<string>';
    return 'vector<int>';
  }
  if (t === 'int' || t === 'integer' || t === 'number') return 'int';
  if (t === 'bool' || t === 'boolean') return 'bool';
  if (t === 'double' || t === 'float') return 'double';
  if (t === 'void' || t === 'nothing') return 'void';
  if (t === 'json') return 'json';
  return 'string';
}

function parseBodyLines(lines) {
  const out = [];
  // consume an indented block of statements. parseMainLine on a line
  // that opens a nested block (if/for) must also eat the indented
  // children, otherwise the children fall through to the next outer
  // iteration and get parsed as siblings.
  // lines are passed in *with leading whitespace preserved* so that
  // nested blocks can be detected by indentation level.
  // `knownIdents` is the set of names the emitter should treat as
  // c++ identifiers (params, locals declared in this scope).
  const knownIdents = (lines && lines.__knownIdents) || new Set();
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw || !raw.trim()) { i++; continue; }
    // strip leading whitespace for regex matching, but remember the indent
    const indent = (raw.match(/^(\s*)/) || ['', ''])[1].length;
    const line = raw.trim();
    const stmt = parseMainLine(line);
    if (!stmt) { i++; continue; }
    // remember new locals as we declare them
    if (stmt.kind === 'set' && stmt.name) knownIdents.add(stmt.name);
    // gather indented children for block-openers. a child is a line whose
    // leading whitespace is strictly greater than the parent's indent.
    if (stmt.kind === 'if' || stmt.kind === 'for') {
      const children = [];
      let j = i + 1;
      while (j < lines.length) {
        const childRaw = lines[j];
        if (!childRaw || !childRaw.trim()) { j++; continue; }
        const childIndent = (childRaw.match(/^(\s*)/) || ['', ''])[1].length;
        if (childIndent <= indent) break;
        children.push(childRaw);
        j++;
      }
      if (children.length) {
        children.__knownIdents = knownIdents;
        stmt.body = parseBodyLines(children);
      }
      if (stmt.kind === 'if' && !stmt.body) stmt.body = [];
      if (stmt.kind === 'for' && !stmt.body) stmt.body = [];
      i = j;
      out.push(stmt);
      continue;
    }
    out.push(stmt);
    i++;
  }
  return out;
}

// parse a raw value (the right-hand side of a `set` or `return`).
// returns { value, isString } so the emitter can distinguish a
// string literal like "x=%d y=%s" (which we strip to `x=%d y=%s`)
// from a bare c++ expression with the same characters. numbers/bools
// come back with isString=false; bare tokens are also isString=false
// so the emitter treats them as identifiers or small DSL expressions.
function parseValue(raw) {
  if (raw === null || raw === undefined) return { value: null, isString: false };
  const s = String(raw).trim();
  if (s === '') return { value: '', isString: true };
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return { value: n, isString: false };
  }
  if (s === 'true' || s === 'false') return { value: s === 'true', isString: false };
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    let inner = s.slice(1, -1);
    inner = inner.replace(/\\\\/g, '\x00').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\x00/g, '\\');
    return { value: inner, isString: true };
  }
  return { value: s, isString: false };
}

// unwrap a parseValue result to a primitive. used by the validator and
// the variable emitter (where a string is fine to default to).
function unwrapValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && v !== null && 'value' in v) return v.value;
  return v;
}

function parseMainLine(line) {
  let m;
  if ((m = line.match(/^print\s+(.+?)\.?$/i))) { const v = parseValue(m[1]); return { kind: 'print', text: v.value, isString: v.isString }; }
  if ((m = line.match(/^(?:ask|read|input)\s+(?:the\s+user\s+for\s+)?(.+?)\.?$/i))) {
    // bug: the variable name used to be a slug of the whole phrase
    // (`ask the user for their name` -> `their_name` is fine, but
    // `ask for age` produced `for_age`). use the *last* token of the
    // phrase as the noun, which is what the user actually means.
    const words = m[1].trim().split(/\s+/).filter(Boolean);
    const noun = words[words.length - 1] || m[1];
    return { kind: 'ask', text: m[1], name: slug(noun) };
  }
  if ((m = line.match(/^(?:set|let)\s+(\w+)\s*=\s*(.+?)\.?$/i))) { const v = parseValue(m[2]); return { kind: 'set', name: slug(m[1]), value: v.value, isString: v.isString }; }
  if ((m = line.match(/^call\s+(\w+)\s*(?:\(([^)]*)\))?\.?$/i))) {
    // bug #3: filter empty args. also try to coerce each arg to a number
    // so call add(2, 3) doesn't pass "2","3" as strings. each arg gets
    // its own isString flag so quoted string-literal args stay strings
    // even if they happen to look like c++ expressions.
    const args = m[2]
      ? m[2].split(',').map(s => s.trim()).filter(Boolean).map(a => {
          const v = parseValue(a);
          return { value: v.value, isString: v.isString };
        })
      : [];
    return { kind: 'call', target: slug(m[1]), args };
  }
  if ((m = line.match(/^(?:GET|fetch|request)\s+(\/\S*)\.?$/i))) { const v = parseValue(m[1]); return { kind: 'http_get', path: v.value, isString: v.isString, method: 'GET' }; }
  if ((m = line.match(/^POST\s+(\/\S*)\.?$/i))) { const v = parseValue(m[1]); return { kind: 'http_post', path: v.value, isString: v.isString, method: 'POST' }; }
  if ((m = line.match(/^PUT\s+(\/\S*)\.?$/i))) { const v = parseValue(m[1]); return { kind: 'http_put', path: v.value, isString: v.isString, method: 'PUT' }; }
  if ((m = line.match(/^PATCH\s+(\/\S*)\.?$/i))) { const v = parseValue(m[1]); return { kind: 'http_patch', path: v.value, isString: v.isString, method: 'PATCH' }; }
  if ((m = line.match(/^DELETE\s+(\/\S*)\.?$/i))) { const v = parseValue(m[1]); return { kind: 'http_delete', path: v.value, isString: v.isString, method: 'DELETE' }; }
  if ((m = line.match(/^return\s+(.+?)\.?$/i))) { const v = parseValue(m[1]); return { kind: 'return', value: v.value, isString: v.isString }; }
  // bug: inner `for each X in Y:` (inside main) used to capture the trailing
  // colon as part of the source, so `for each item in items:` lowered to
  // `for (auto& item : "items:")` instead of `"items"`. allow [.:]? like the
  // top-level handler does.
  if ((m = line.match(/^for\s+each\s+(\w+)\s+in\s+(.+?)\s*[.:]?\s*$/i))) { const v = parseValue(m[2]); return { kind: 'for', iter: slug(m[1]), source: v.value, isString: v.isString }; }
  if ((m = line.match(/^if\s+(.+?)\s*:\s*$/i))) return { kind: 'if', cond: m[1], body: [] };
  if ((m = line.match(/^log\s+(?:(\w+)\s+)?(.+?)\.?$/i))) { const v = parseValue(m[2]); return { kind: 'log', level: m[1] || 'info', text: v.value, isString: v.isString }; }
  if ((m = line.match(/^sleep\s+(\d+)\.?$/i))) return { kind: 'sleep', ms: Number(m[1]) };
  if ((m = line.match(/^assert\s+(.+?)\.?$/i))) return { kind: 'assert', cond: m[1] };
  if ((m = line.match(/^json_load\s+(\S+)\.?$/i))) { const v = parseValue(m[1]); return { kind: 'json_load', path: v.value, isString: v.isString }; }
  if ((m = line.match(/^json_save\s+(\S+)(?:\s+with\s+(.+?))?\.?$/i))) { const v = parseValue(m[1]); const w = m[2] ? parseValue(m[2]) : null; return { kind: 'json_save', path: v.value, isString: v.isString, value: w ? w.value : null, valueIsString: w ? w.isString : false }; }
  if ((m = line.match(/^file_read\s+(\S+)(?:\s+into\s+(\w+))?\.?$/i))) { const v = parseValue(m[1]); return { kind: 'file_read', path: v.value, isString: v.isString, name: slug(m[2] || 'data') }; }
  if ((m = line.match(/^file_write\s+(\S+)(?:\s+with\s+(.+?))?\.?$/i))) { const v = parseValue(m[1]); const w = m[2] ? parseValue(m[2]) : null; return { kind: 'file_write', path: v.value, isString: v.isString, value: w ? w.value : null, valueIsString: w ? w.isString : false }; }
  // bug: file-rename / file-delete stmts. `rename FROM to TO` and
  // `delete PATH` cover the file-management vocabulary that the
  // file-renamer example relies on. without these, the example was
  // a hard parse error.
  if ((m = line.match(/^rename\s+(\S+)\s+to\s+(\S+)\.?$/i))) { const a = parseValue(m[1]); const b = parseValue(m[2]); return { kind: 'file_rename', from: a.value, fromIsString: a.isString, to: b.value, toIsString: b.isString }; }
  if ((m = line.match(/^delete\s+(\S+)\.?$/i))) { const v = parseValue(m[1]); return { kind: 'file_delete', path: v.value, isString: v.isString }; }
  if ((m = line.match(/^serve(?:\s+on)?(?:\s+port)?\s+(\d+|[A-Za-z_]+)\.?$/i))) return { kind: 'http_serve', port: m[1] };
  if ((m = line.match(/^(?:listen\s+on|start\s+server\s+on)\s+(?:port\s+)?(\d+|[A-Za-z_]+)\.?$/i))) return { kind: 'http_serve', port: m[1] };
  // raw c++ fallback. restricted to lines that begin with `raw ` so
  // the structured DSL doesn't accidentally emit c++ for an unknown
  // verb. anything else unmatched is dropped (and commented in the
  // generated c++) so prompt-injection in prose cannot flow through.
  if (/^raw\s+/.test(line)) return { kind: 'raw', code: line.replace(/^raw\s+/, '') };
  return { kind: 'unsupported', text: line };
}
