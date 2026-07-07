// deps resolver - maps natural language to vcpkg ports
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(readFileSync(join(__dirname, 'library-map.json'), 'utf8'));

// build reverse index: lowercased key -> vcpkg name
const INDEX = new Map();
for (const e of MAP.entries) {
  for (const k of e.keys) INDEX.set(k.toLowerCase(), e.vcpkg);
}

export function lookup(name) {
  const k = String(name || '').toLowerCase().trim();
  if (INDEX.has(k)) return INDEX.get(k);
  // try substring match
  for (const [key, vcpkg] of INDEX) {
    if (k.includes(key) || key.includes(k)) return vcpkg;
  }
  return null;
}

export function resolveRequirements(reqs, llmFallback = null) {
  const out = new Map();
  const unknown = [];
  for (const r of reqs) {
    // skip requirements that the LLM guard marked as unsupported. these
    // are names we couldn't map to a port we know how to link, so they
    // must not flow into vcpkg.json.
    if (r.source === 'unsupported') continue;
    const hit = lookup(r.name);
    if (hit) {
      if (!out.has(hit)) out.set(hit, new Set());
      if (r.features) for (const f of r.features) out.get(hit).add(f);
    } else {
      unknown.push(r.name);
    }
  }
  return { packages: Array.from(out.keys()), features: Object.fromEntries([...out].map(([k,v]) => [k, [...v]])), unknown };
}

export function allowlist() {
  return MAP.entries.map(e => e.vcpkg);
}
