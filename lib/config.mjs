// config loader - merges defaults, env, cli opts, optional .nlpcrc
import { readFileSync, existsSync } from 'node:fs'; // fs
import { resolve, join } from 'node:path'; // path
import { homedir } from 'node:os'; // os

console.log('config.mjs load'); // trace

const DEFAULTS = { // defaults
  model: 'codellama:7b-instruct', // default model
  ollamaHost: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434', // ollama url
  vcpkgRoot: process.env.VCPKG_ROOT || null, // vcpkg root
  cmake: 'cmake', // cmake binary
  cxx: process.platform === 'win32' ? 'g++' : 'g++', // compiler
  repairMax: 5, // repair attempts
  timeoutMs: 300_000, // 5 min per stage
  buildType: 'Release', // cmake build type
};

export async function loadConfig(opts = {}) { // export
  console.log('loadConfig opts', opts); // trace
  const rcPaths = [ // rc paths to try
    resolve(process.cwd(), '.nlpcrc.json'), // cwd
    join(homedir(), '.nlpcrc.json'), // home
  ];
  let rc = {}; // init
  for (const p of rcPaths) { // loop
    if (existsSync(p)) { // exists
      try { rc = JSON.parse(readFileSync(p, 'utf8')); console.log('rc loaded', p); break; } // parse
      catch (e) { console.warn('rc parse fail', p, e.message); } // warn
    }
  }
  const merged = { // merge
    ...DEFAULTS, // defaults first
    ...rc, // then rc
    ...opts, // then cli wins
    ollamaHost: opts.ollamaHost || DEFAULTS.ollamaHost, // explicit host
    vcpkgRoot: opts.vcpkgRoot || rc.vcpkgRoot || DEFAULTS.vcpkgRoot, // root
  };
  console.log('config merged', merged); // trace
  return merged; // return
}
