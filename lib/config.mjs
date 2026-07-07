// config loader - merges defaults, env, cli opts, optional .nlpcrc
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULTS = {
  model: null,
  ollamaHost: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
  vcpkgRoot: process.env.VCPKG_ROOT || null,
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
    ollamaHost: opts.ollamaHost || rc.ollamaHost || DEFAULTS.ollamaHost,
    vcpkgRoot: opts.vcpkgRoot || rc.vcpkgRoot || DEFAULTS.vcpkgRoot,
  };
  return merged;
}
