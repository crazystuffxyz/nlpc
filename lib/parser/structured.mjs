// structured parser - extracts the "Require:", "Make function:", "When program starts:" dsl
import { readFileSync } from 'node:fs';

// block types we know
const PATTERNS = [
  { kind: 'require', re: /^[ \t]*Require\s+the\s+(.+?)\s*\.?\s*$/im },
  { kind: 'require', re: /^[ \t]*Need\s*:?\s+(.+?)\s*\.?\s*$/im },
  { kind: 'require', re: /^[ \t]*Use\s+(?:the\s+)?(.+?)\s+library\s*\.?\s*$/im },
  { kind: 'function', re: /Make\s+(?:a\s+)?function\s+called\s+(\w+)/i },
  { kind: 'main', re: /^[ \t]*When\s+the\s+program\s+starts\s*:\s*$/im },
  { kind: 'application', re: /^[ \t]*Create\s+a\s+(console|rest|window|gui|web|cli)\s+application\s*\.?\s*$/im },
  { kind: 'application', re: /^[ \t]*Application\s*:\s*$/im },
  { kind: 'field', re: /^[ \t]*type\s*:\s*(.+?)\s*\.?\s*$/im },
  { kind: 'route', re: /^[ \t]*(GET|POST|PUT|DELETE|PATCH)\s+(\S+)\s*\.?\s*$/im },
  { kind: 'print', re: /^[ \t]*print\s+(.+?)\s*\.?\s*$/im },
  { kind: 'ask', re: /^[ \t]*(?:ask|read|input)\s+(?:the\s+user\s+for\s+)?(.+?)\s*\.?\s*$/im },
  { kind: 'http_get', re: /^[ \t]*(?:GET|fetch|request)\s+(\S+)\s*\.?\s*$/im },
  // bug: the http_serve regex used to be `(?:serve|listen\s+on|...)\s+(?:port\s+)?`
  // which didn't allow "serve on port 9090" - it had to be "serve 9090" or
  // "serve port 9090". accept the optional "on" between "serve" and the
  // port to handle natural phrasing.
  { kind: 'http_serve', re: /^[ \t]*(?:serve(?:\s+on)?|listen(?:\s+on)?|start\s+server(?:\s+on)?)\s+(?:port\s+)?(\d+|[A-Za-z_]\w*)\s*\.?\s*$/im },
  { kind: 'loop', re: /^[ \t]*(?:for\s+each|loop|repeat|iterate)\s+(.+?)\s*\.?\s*$/im },
  { kind: 'if', re: /^[ \t]*if\s+(.+?)\s*:\s*$/im },
  { kind: 'return', re: /^[ \t]*return\s+(.+?)\s*\.?\s*$/im },
  { kind: 'set', re: /^[ \t]*(?:set|let)\s+(\w+)\s*=\s*(.+?)\s*\.?\s*$/im },
  { kind: 'call', re: /^[ \t]*call\s+(\w+)\s*(?:\(([^)]*)\))?\s*\.?\s*$/im },
];

export function parseStructured(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  const prose = [];
  let i = 0;
  let inApp = false;
  let appType = null;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) { i++; continue; }
    if (inApp && /^[A-Za-z]/.test(line) && !line.includes(':')) { inApp = false; }
    let matched = null;
    for (const p of PATTERNS) {
      if (p.kind === 'field' && !inApp) continue;
      const m = line.match(p.re);
      if (m) { matched = { kind: p.kind, raw: line, m }; break; }
    }
    if (matched) {
      if (matched.kind === 'application') {
        if (matched.m[1]) { appType = matched.m[1].toLowerCase(); blocks.push({ kind: 'application', type: appType, ln: i+1 }); }
        else { inApp = true; blocks.push({ kind: 'application_header', ln: i+1 }); }
      } else if (matched.kind === 'field') {
        blocks.push({ kind: 'app_field', key: 'type', value: matched.m[1].trim(), ln: i+1 });
      } else if (matched.kind === 'main') {
        // collect indented lines as body, preserving original indentation
        // so parseBodyLines in the ir builder can detect nested blocks.
        const body = [];
        let j = i + 1;
        while (j < lines.length && (/^\s/.test(lines[j]) || lines[j].trim() === '')) {
          if (lines[j].trim()) body.push(lines[j]);
          j++;
        }
        blocks.push({ kind: 'main', body, ln: i+1 });
        i = j; continue;
      } else if (matched.kind === 'function') {
        const rest = matched.raw;
        const name = matched.m[1];
        // extract returns - 'returns X' or 'returns a list of strings' anywhere
        // bug #7: the old regex (\w+) only captured a single word, so
        // "returns a list of strings" matched only "list" and guessType
        // produced vector<int>. match the multi-word phrase form first.
        // also accept the rust-style "-> type" form.
        let returns = null;
        const retListM = rest.match(/returns?\s+(?:an?\s+)?list\s+of\s+(\w+)/i);
        if (retListM) {
          const inner = retListM[1].toLowerCase();
          returns = inner === 'string' || inner === 'strings' ? 'vector<string>' : 'vector<int>';
        } else {
          const retMatch = rest.match(/returns?\s+(?:an?\s+)?(\w+(?:\s+of\s+\w+)?)/i);
          if (retMatch) returns = retMatch[1];
          else {
            const arrowMatch = rest.match(/->\s*(\w+(?:\s+of\s+\w+)?)/i);
            if (arrowMatch) returns = arrowMatch[1];
          }
        }
        // extract params from paren form, or 'takes X' form
        let params = [];
        const parenM = rest.match(/\(([^)]+)\)/);
        if (parenM) {
          // bug #6: the old code did split(' ').pop() which threw away
          // the type and kept only the name. parse (type name, type name)
          // pairs and use the explicit type token.
          // also accept the rust-style "name: type" form: the first
          // segment ending with `:` is the name, the rest is the type.
          params = parenM[1].split(',').map(s => {
            const parts = s.trim().split(/\s+/).filter(Boolean);
            if (parts.length === 0) return null;
            if (parts.length === 1) {
              return { name: parts[0].replace(/:$/, ''), type: null };
            }
            const first = parts[0].replace(/[,:.]+$/, '');
            if (first !== parts[0]) {
              // rust-style: name: type [type ...]
              return { name: first, type: parts.slice(1).join(' ') };
            }
            // c-style: type [type ...] name
            return { name: parts[parts.length - 1], type: parts.slice(0, -1).join(' ') };
          }).filter(Boolean);
        } else {
          const takesM = rest.match(/takes?\s+(.+?)(?:\s+and\s+returns?|\s*\.?\s*$)/i);
          if (takesM) {
            const words = takesM[1].replace(/['"]/g, '').split(/\s+/).filter(Boolean);
            const filtered = words.filter(w => !/^(a|an|the|person|user)$/i.test(w));
            if (filtered.length) params = [{ name: filtered[filtered.length - 1], type: null }];
          }
        }
        // bug #2 + #9: function blocks never captured an indented body.
        // mirror the main-block indentation-gathering loop so the offline
        // DSL can actually populate fn bodies. preserve original leading
        // whitespace so parseBodyLines in the ir builder can detect
        // nested if/for blocks.
        const body = [];
        let j = i + 1;
        while (j < lines.length && (/^\s/.test(lines[j]) || lines[j].trim() === '')) {
          if (lines[j].trim()) body.push(lines[j]);
          j++;
        }
        blocks.push({ kind: 'function', name, params, returns, body, ln: i+1 });
        // skip past the body we just consumed, the same way main does
        if (body.length) i = j - 1;
      } else if (matched.kind === 'require') {
        blocks.push({ kind: 'require', name: matched.m[1].trim(), ln: i+1 });
      } else if (matched.kind === 'http_serve') {
        blocks.push({ kind: 'http_serve', port: matched.m[1], ln: i+1 });
      } else if (matched.kind === 'route') {
        // collect indented lines as the route's body, same shape as
        // main/function bodies. without this, statements under a route
        // fall through to the top-level matcher and get attached to the
        // wrong block (or rejected as free-form prose).
        const body = [];
        let j = i + 1;
        while (j < lines.length && (/^\s/.test(lines[j]) || lines[j].trim() === '')) {
          if (lines[j].trim()) body.push(lines[j]);
          j++;
        }
        blocks.push({ kind: 'route', method: matched.m[1].toUpperCase(), path: matched.m[2], body, ln: i+1 });
        if (body.length) i = j - 1;
      } else if (matched.kind === 'if' || matched.kind === 'loop') {
        // bug #13: top-level `if X:` and `for each X in Y:` lines need to
        // consume their indented children, the same way main/function/route
        // do. without this, the children fall through to the top-level
        // matcher and get attached as siblings (or rejected as prose).
        const body = [];
        let j = i + 1;
        while (j < lines.length && (/^\s/.test(lines[j]) || lines[j].trim() === '')) {
          if (lines[j].trim()) body.push(lines[j]);
          j++;
        }
        blocks.push({ kind: matched.kind, raw: line, m: matched.m.slice(1), body, ln: i+1 });
        if (body.length) i = j - 1;
      } else {
        blocks.push({ kind: matched.kind, raw: line, m: matched.m.slice(1), ln: i+1 });
      }
      i++;
    } else {
      // treat as free-form prose
      prose.push(line);
      i++;
    }
  }
  return { blocks, prose };
}

export function parseFile(path) {
  const text = readFileSync(path, 'utf8');
  return parseStructured(text);
}
