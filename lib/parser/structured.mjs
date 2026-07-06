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
  { kind: 'http_serve', re: /^[ \t]*(?:serve|listen\s+on|start\s+server\s+on)\s+(?:port\s+)?(\d+|[A-Z_]+)\s*\.?\s*$/im },
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
        // collect indented lines as body
        const body = [];
        let j = i + 1;
        while (j < lines.length && (/^\s{2,}|\t/.test(lines[j]) || lines[j].trim() === '')) {
          if (lines[j].trim()) body.push(lines[j].trim());
          j++;
        }
        blocks.push({ kind: 'main', body, ln: i+1 });
        i = j; continue;
      } else if (matched.kind === 'function') {
        const rest = matched.raw;
        const name = matched.m[1];
        // extract returns - 'returns X' anywhere
        const retMatch = rest.match(/returns?\s+(?:an?\s+)?(\w+)/i);
        const returns = retMatch ? retMatch[1] : null;
        // extract params from paren form, or 'takes X' form
        let params = [];
        const parenM = rest.match(/\(([^)]+)\)/);
        if (parenM) {
          params = parenM[1].split(',').map(s => s.trim().split(/\s+/).pop()).filter(Boolean);
        } else {
          const takesM = rest.match(/takes?\s+(.+?)(?:\s+and\s+returns?|\s*\.?\s*$)/i);
          if (takesM) {
            const words = takesM[1].replace(/['"]/g, '').split(/\s+/).filter(Boolean);
            // pull the trailing noun as a parameter name (e.g. "a person's name" -> "name")
            const filtered = words.filter(w => !/^(a|an|the|person|user)$/i.test(w));
            if (filtered.length) params = [filtered[filtered.length - 1]];
          }
        }
        blocks.push({ kind: 'function', name, params, returns, ln: i+1 });
      } else if (matched.kind === 'require') {
        blocks.push({ kind: 'require', name: matched.m[1].trim(), ln: i+1 });
      } else if (matched.kind === 'http_serve') {
        blocks.push({ kind: 'http_serve', port: matched.m[1], ln: i+1 });
      } else if (matched.kind === 'route') {
        blocks.push({ kind: 'route', method: matched.m[1].toUpperCase(), path: matched.m[2], ln: i+1 });
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
