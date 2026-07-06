// ir builder - structured blocks -> ir (no llm path)
import { validateIR } from './validator.mjs';

function slug(s) {
  return String(s || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'app';
}

export function buildIR(blocks, prose = [], programName = null) {
  const ir = {
    program: { name: programName ? slug(programName) : 'app', kind: 'console', entry: 'main' },
    requirements: [],
    declarations: [],
    behaviors: [],
    constraints: [{ kind: 'cxx_standard', value: '20' }],
  };
  const seenReq = new Set();
  for (const b of blocks) {
    if (b.kind === 'require') {
      const key = b.name.toLowerCase();
      if (!seenReq.has(key)) { seenReq.add(key); ir.requirements.push({ name: b.name, source: 'vcpkg' }); }
    } else if (b.kind === 'application') {
      ir.program.kind = b.type || 'console';
    } else if (b.kind === 'app_field' && b.value) {
      const t = b.value.toLowerCase();
      if (t.includes('rest') || t.includes('api')) ir.program.kind = 'rest';
      else if (t.includes('window') || t.includes('gui')) ir.program.kind = 'window';
      else if (t.includes('console') || t.includes('cli')) ir.program.kind = 'console';
    } else if (b.kind === 'function') {
      const fn = {
        kind: 'function',
        name: b.name,
        params: b.params.map(p => ({ name: slug(p), type: guessType(p) })),
        returns: b.returns ? guessType(b.returns) : 'string',
        body: [],
      };
      ir.declarations.push(fn);
    } else if (b.kind === 'main') {
      const beh = { trigger: 'start', body: [] };
      for (const line of b.body) {
        const stmt = parseMainLine(line);
        if (stmt) beh.body.push(stmt);
      }
      ir.behaviors.push(beh);
    } else if (b.kind === 'print') {
      ir.behaviors.push({ trigger: 'start', body: [{ kind: 'print', text: b.m[0] }] });
    } else if (b.kind === 'ask') {
      ir.behaviors.push({ trigger: 'start', body: [{ kind: 'ask', text: b.m[0], name: slug(b.m[0]) }] });
    } else if (b.kind === 'http_serve') {
      ir.behaviors.push({ trigger: 'start', body: [{ kind: 'http_serve', port: b.port }] });
    } else if (b.kind === 'route') {
      ir.behaviors.push({ trigger: 'route', method: b.method, path: b.path, body: [] });
    } else if (b.kind === 'set') {
      ir.declarations.push({ kind: 'variable', name: b.m[0], value: b.m[1] });
    }
  }
  if (ir.program.kind === 'rest') {
    if (!ir.requirements.find(r => /httplib|cpr/i.test(r.name))) {
      ir.requirements.push({ name: 'cpp-httplib', source: 'vcpkg' });
    }
  }
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
  if (t.includes('int')) return 'int';
  if (t.includes('bool')) return 'bool';
  if (t.includes('double') || t.includes('float') || t.includes('number')) return 'double';
  if (t.includes('void') || t === 'nothing') return 'void';
  if (t.includes('list') || t.includes('array') || t.includes('vector')) {
    if (t.includes('string')) return 'vector<string>';
    return 'vector<int>';
  }
  return 'string';
}

function parseMainLine(line) {
  let m;
  if ((m = line.match(/^print\s+(.+?)\.?$/i))) return { kind: 'print', text: m[1] };
  if ((m = line.match(/^(?:ask|read|input)\s+(?:the\s+user\s+for\s+)?(.+?)\.?$/i))) return { kind: 'ask', text: m[1], name: slug(m[1]) };
  if ((m = line.match(/^(?:set|let)\s+(\w+)\s*=\s*(.+?)\.?$/i))) return { kind: 'set', name: m[1], value: m[2] };
  if ((m = line.match(/^call\s+(\w+)\s*(?:\(([^)]*)\))?\.?$/i))) return { kind: 'call', target: m[1], args: m[2] ? m[2].split(',').map(s=>s.trim()) : [] };
  if ((m = line.match(/^(?:GET|fetch|request)\s+(\S+)\.?$/i))) return { kind: 'http_get', path: m[1] };
  if ((m = line.match(/^(?:POST|put|patch)\s+(\S+)\.?$/i))) return { kind: 'http_get', path: m[1], method: m[0].split(' ')[0].toUpperCase() };
  if ((m = line.match(/^return\s+(.+?)\.?$/i))) return { kind: 'return', value: m[1] };
  if ((m = line.match(/^for\s+each\s+(\w+)\s+in\s+(.+?)\.?$/i))) return { kind: 'for', iter: m[1], source: m[2] };
  if ((m = line.match(/^if\s+(.+?)\s*:\s*$/i))) return { kind: 'if', cond: m[1], body: [] };
  // raw c++ fallback
  return { kind: 'raw', code: line };
}
