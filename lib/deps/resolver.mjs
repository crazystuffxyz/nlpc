// deps resolver - maps natural language to vcpkg ports
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(readFileSync(join(__dirname, 'library-map.json'), 'utf8'));

// build reverse index: lowercased key -> vcpkg name. keep an array
// of (key, vcpkg) pairs sorted by key length descending so substring
// matches prefer the most-specific key. short common substrings
// (sql, json, http, fmt, log) used to match first because
// `for (const [key, vcpkg] of INDEX)` walks the insertion order -
// and json happens to land before mariadb/mysql/etc. longest-first
// ordering fixes that without changing the substring rule itself.
const INDEX = new Map();
const PAIRS = [];
for (const e of MAP.entries) {
  for (const k of e.keys) {
    const kk = k.toLowerCase();
    INDEX.set(kk, e.vcpkg);
    PAIRS.push([kk, e.vcpkg]);
  }
}
PAIRS.sort((a, b) => b[0].length - a[0].length);

export function lookup(name) {
  const k = String(name || '').toLowerCase().trim();
  if (!k) return null;
  if (INDEX.has(k)) return INDEX.get(k);
  // try substring match. forward only - the previous bidirectional
  // `key.includes(k)` made `lookup('f')` match `fmt` (since 'fmt'
  // contains 'f') and `lookup('')` matched the first entry (since
  // every key contains the empty string). only look for keys that
  // are substrings of the user's input, never the reverse.
  for (const [key, vcpkg] of PAIRS) {
    if (k.includes(key)) return vcpkg;
  }
  // bug: `lookup('magic-enum')` used to fail because the library-map
  // key is `magic_enum` (underscore) and the vcpkg port is
  // `magic-enum` (hyphen). c++/vcpkg users tend to write either
  // form. fall back to a normalized form: replace - with _ (and
  // vice versa) and try exact equality. only exact equality (not
  // substring) so this can't re-introduce the empty-string /
  // single-letter false positives the forward pass was designed
  // to remove.
  const alt = k.replace(/-/g, '_');
  for (const [key, vcpkg] of PAIRS) {
    if (alt === key) return vcpkg;
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
