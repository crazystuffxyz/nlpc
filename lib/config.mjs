// config loader - merges defaults, env, cli opts, optional .nlpcrc
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

// bug #22: precedence is env > cli > rc > defaults. previously DEFAULTS
// captured process.env.OLLAMA_HOST, then rc.ollamaHost overrode it, so
// the env var was beaten by a stale .nlpcrc.json. capture env at lookup
// time (not at module load time) and merge after rc/cli so it wins.
const envVal = (k, fallback) => process.env[k] || fallback;

const DEFAULTS = {
  model: null,
  ollamaHost: 'http://127.0.0.1:11434',
  vcpkgRoot: null,
  // default to the mingw-dynamic triplet on win32 when cxx is mingw g++.
  // vcpkg's auto-detect picks MSVC first and builds .lib files the mingw
  // linker can't read, so we set a sane default and let the user override
  // via cfg/rc. on non-win32 the default is empty (vcpkg picks the host).
  vcpkgTriplet: process.env.VCPKG_TARGET_TRIPLET
    || (process.platform === 'win32' ? 'x64-mingw-dynamic' : ''),
  cmake: 'cmake',
  cxx: process.platform === 'win32' ? 'g++' : 'g++',
  repairMax: 5,
  timeoutMs: 300_000,
  buildType: 'Release',
};

export async function loadConfig(opts = {}) {
  const rcPaths = [
    resolve(process.cwd(), '.nlpcrc.json'),
    join(homedir(), '.nlpcrc.json'),
  ];
  let rc = {};
  for (const p of rcPaths) {
    if (existsSync(p)) {
      try {
        rc = JSON.parse(readFileSync(p, 'utf8'));
        break;
      } catch (e) {
        console.warn('rc parse fail', p, e.message);
      }
    }
  }
  const merged = {
    ...DEFAULTS,
    ...rc,
    ...opts,
    ollamaHost: envVal('OLLAMA_HOST', opts.ollamaHost || rc.ollamaHost || DEFAULTS.ollamaHost),
    vcpkgRoot: envVal('VCPKG_ROOT', opts.vcpkgRoot || rc.vcpkgRoot || DEFAULTS.vcpkgRoot),
    vcpkgTriplet: envVal('VCPKG_TARGET_TRIPLET', opts.vcpkgTriplet || rc.vcpkgTriplet || DEFAULTS.vcpkgTriplet),
  };
  return merged;
}
