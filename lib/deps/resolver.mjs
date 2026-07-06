// deps resolver - maps natural language to vcpkg ports
import { readFileSync } from 'node:fs'; // fs
import { fileURLToPath } from 'node:url'; // url
import { dirname, join } from 'node:path'; // path

console.log('deps/resolver.mjs load'); // trace

const __dirname = dirname(fileURLToPath(import.meta.url)); // our dir
const MAP = JSON.parse(readFileSync(join(__dirname, 'library-map.json'), 'utf8')); // load
console.log('library map entries', MAP.entries.length); // trace

// build reverse index: lowercased key -> vcpkg name
const INDEX = new Map(); // index
for (const e of MAP.entries) { // loop
  for (const k of e.keys) INDEX.set(k.toLowerCase(), e.vcpkg); // set
}

export function lookup(name) { // direct lookup
  const k = String(name || '').toLowerCase().trim(); // key
  if (INDEX.has(k)) return INDEX.get(k); // hit
  // try substring match
  for (const [key, vcpkg] of INDEX) { // loop
    if (k.includes(key) || key.includes(k)) return vcpkg; // partial
  }
  return null;
}

export function resolveRequirements(reqs, llmFallback = null) { // main
  console.log('resolveRequirements', reqs.length); // trace
  const out = new Map(); // vcpkg -> features
  const unknown = []; // collect unknown
  for (const r of reqs) { // loop
    const hit = lookup(r.name); // try
    if (hit) { // got
      if (!out.has(hit)) out.set(hit, new Set()); // init
      if (r.features) for (const f of r.features) out.get(hit).add(f); // features
    } else { // unknown
      unknown.push(r.name); // push
    }
  }
  return { packages: Array.from(out.keys()), features: Object.fromEntries([...out].map(([k,v]) => [k, [...v]])), unknown };
}

export function allowlist() { // list of known vcpkg ports for llm
  return MAP.entries.map(e => e.vcpkg);
}
