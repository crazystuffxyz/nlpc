// update-checker - non-blocking version check against the GitHub releases API
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const REPO = 'crazystuffxyz/nlpc';
const TIMEOUT_MS = 1500;

let _current = null;
let _resolved = false;
export function currentVersion() {
  if (_resolved) return _current;
  _resolved = true;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const p = resolve(here, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(p, 'utf8'));
    _current = pkg.version;
  } catch { _current = '0.0.0'; }
  return _current;
}

export function cmp(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export async function checkForUpdate() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      signal: ctl.signal,
      headers: { 'Accept': 'application/vnd.github+json' },
    });
    if (!r.ok) return { ok: false, reason: `http ${r.status}` };
    const j = await r.json();
    const tag = j.tag_name || '';
    const cur = currentVersion();
    if (!tag) return { ok: false, reason: 'no tag in response' };
    const upToDate = cmp(tag, cur) <= 0;
    if (!upToDate) {
      return { ok: true, current: cur, latest: tag, upToDate: false, url: j.html_url, name: j.name };
    }
    return { ok: true, current: cur, latest: tag, upToDate: true };
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(t);
  }
}
