// structured parser - extracts the "Require:", "Make function:", "When program starts:" dsl
import { readFileSync } from 'node:fs'; // fs

console.log('parser/structured.mjs load'); // trace

// block types we know
const PATTERNS = [ // ordered - first match wins
  { kind: 'require', re: /^[ \t]*Require\s+the\s+(.+?)\s*\.?\s*$/im }, // require
  { kind: 'require', re: /^[ \t]*Need\s*:?\s+(.+?)\s*\.?\s*$/im }, // alias
  { kind: 'require', re: /^[ \t]*Use\s+(?:the\s+)?(.+?)\s+library\s*\.?\s*$/im }, // "use fmt library"
  { kind: 'function', re: /Make\s+(?:a\s+)?function\s+called\s+(\w+)/i }, // fn decl (loose)
  { kind: 'main', re: /^[ \t]*When\s+the\s+program\s+starts\s*:\s*$/im }, // entry
  { kind: 'application', re: /^[ \t]*Create\s+a\s+(console|rest|window|gui|web|cli)\s+application\s*\.?\s*$/im }, // app type
  { kind: 'application', re: /^[ \t]*Application\s*:\s*$/im }, // app header
  { kind: 'field', re: /^[ \t]*type\s*:\s*(.+?)\s*\.?\s*$/im }, // typed field under Application
  { kind: 'route', re: /^[ \t]*(GET|POST|PUT|DELETE|PATCH)\s+(\S+)\s*\.?\s*$/im }, // route (before http_get)
  { kind: 'print', re: /^[ \t]*print\s+(.+?)\s*\.?\s*$/im }, // print
  { kind: 'ask', re: /^[ \t]*(?:ask|read|input)\s+(?:the\s+user\s+for\s+)?(.+?)\s*\.?\s*$/im }, // ask
  { kind: 'http_get', re: /^[ \t]*(?:GET|fetch|request)\s+(\S+)\s*\.?\s*$/im }, // http get (loose, no route-like path)
  { kind: 'http_serve', re: /^[ \t]*(?:serve|listen\s+on|start\s+server\s+on)\s+(?:port\s+)?(\d+|[A-Z_]+)\s*\.?\s*$/im }, // serve
  { kind: 'loop', re: /^[ \t]*(?:for\s+each|loop|repeat|iterate)\s+(.+?)\s*\.?\s*$/im }, // loop
  { kind: 'if', re: /^[ \t]*if\s+(.+?)\s*:\s*$/im }, // if
  { kind: 'return', re: /^[ \t]*return\s+(.+?)\s*\.?\s*$/im }, // return
  { kind: 'set', re: /^[ \t]*(?:set|let)\s+(\w+)\s*=\s*(.+?)\s*\.?\s*$/im }, // assignment
  { kind: 'call', re: /^[ \t]*call\s+(\w+)\s*(?:\(([^)]*)\))?\s*\.?\s*$/im }, // call
];

export function parseStructured(text) { // main entry
  console.log('parseStructured, bytes', text.length); // trace
  const lines = text.split(/\r?\n/); // split
  const blocks = []; // collect
  const prose = []; // free-form
  let i = 0; // line idx
  let inApp = false; // inside Application block
  let appType = null; // app type
  while (i < lines.length) { // loop
    const raw = lines[i]; // raw line
    const line = raw.trim(); // trim
    if (!line || line.startsWith('//') || line.startsWith('#')) { i++; continue; } // skip blank/comment
    if (inApp && /^[A-Za-z]/.test(line) && !line.includes(':')) { inApp = false; } // exit app block when bare header
    let matched = null; // init
    for (const p of PATTERNS) { // try patterns
      if (p.kind === 'field' && !inApp) continue; // field only in app
      const m = line.match(p.re); // try
      if (m) { matched = { kind: p.kind, raw: line, m }; break; } // got
    }
    if (matched) { // matched
      if (matched.kind === 'application') { // app type
        if (matched.m[1]) { appType = matched.m[1].toLowerCase(); blocks.push({ kind: 'application', type: appType, ln: i+1 }); }
        else { inApp = true; blocks.push({ kind: 'application_header', ln: i+1 }); }
      } else if (matched.kind === 'field') { // field under Application
        blocks.push({ kind: 'app_field', key: 'type', value: matched.m[1].trim(), ln: i+1 });
      } else if (matched.kind === 'main') { // main block start
        // collect indented lines as body
        const body = []; // body lines
        let j = i + 1; // next
        while (j < lines.length && (/^\s{2,}|\t/.test(lines[j]) || lines[j].trim() === '')) { // indented or blank
          if (lines[j].trim()) body.push(lines[j].trim()); // push
          j++;
        }
        blocks.push({ kind: 'main', body, ln: i+1 });
        i = j; continue;
      } else if (matched.kind === 'function') { // function decl
        const rest = matched.raw; // whole raw line
        const name = matched.m[1]; // name
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
      } else if (matched.kind === 'require') { // require
        blocks.push({ kind: 'require', name: matched.m[1].trim(), ln: i+1 });
      } else if (matched.kind === 'http_serve') { // serve
        blocks.push({ kind: 'http_serve', port: matched.m[1], ln: i+1 });
      } else if (matched.kind === 'route') { // route
        blocks.push({ kind: 'route', method: matched.m[1].toUpperCase(), path: matched.m[2], ln: i+1 });
      } else { // simple
        blocks.push({ kind: matched.kind, raw: line, m: matched.m.slice(1), ln: i+1 });
      }
      i++;
    } else {
      // treat as free-form prose
      prose.push(line);
      i++;
    }
  }
  console.log('parseStructured blocks', blocks.length, 'prose', prose.length); // trace
  return { blocks, prose };
}

export function parseFile(path) { // file variant
  console.log('parseFile', path); // trace
  const text = readFileSync(path, 'utf8'); // read
  return parseStructured(text); // delegate
}
