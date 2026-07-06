// setup - detect missing tools, offer to install them
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const ex = promisify(execFile);

// a tool is "present" if its binary is on PATH or its root env var points at it
const TOOLS = [
  { id: 'g++', label: 'c++ compiler (g++)', check: async () => ok('g++', ['--version']) },
  { id: 'cmake', label: 'cmake', check: async () => ok('cmake', ['--version']) },
  { id: 'vcpkg', label: 'vcpkg', check: async () => {
      const root = process.env.VCPKG_ROOT || join(homedir(), 'vcpkg-master');
      if (!existsSync(root)) return null;
      const bin = process.platform === 'win32' ? 'vcpkg.exe' : 'vcpkg';
      if (!existsSync(resolve(root, bin))) return null;
      return root;
    } },
  { id: 'ollama', label: 'ollama', check: async () => {
      try { const r = await fetch((process.env.OLLAMA_HOST || 'http://127.0.0.1:11434') + '/api/version'); return r.ok; }
      catch { return false; }
    } },
  { id: 'node', label: 'node', check: async () => process.version },
];

async function ok(cmd, args) {
  try { await ex(cmd, args); return true; } catch { return false; }
}

// install commands per platform. we don't auto-run winget without a confirm.
function installCmd(id) {
  const p = process.platform;
  if (id === 'g++' || id === 'cmake') {
    if (p === 'win32') return ['winget', ['install', '--id', id === 'g++' ? 'BrechtSanders.WinLibs.POSIX.UCRT' : 'Kitware.CMake', '-e', '--accept-source-agreements', '--accept-package-agreements']];
    if (p === 'darwin') return ['brew', ['install', id === 'g++' ? 'gcc' : 'cmake']];
    return ['sudo', ['apt-get', 'install', '-y', id === 'g++' ? 'g++' : 'cmake']];
  }
  if (id === 'vcpkg') {
    if (p === 'win32') return null; // too involved for one cmd; user must clone
    return null;
  }
  if (id === 'ollama') {
    if (p === 'win32') return ['winget', ['install', '--id', 'Ollama.Ollama', '-e', '--accept-source-agreements', '--accept-package-agreements']];
    if (p === 'darwin') return ['brew', ['install', 'ollama']];
    return ['bash', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh']];
  }
  return null;
}

export async function setup({ yes = false, dryRun = false } = {}) {
  const missing = [];
  for (const t of TOOLS) {
    let present = false;
    try { present = !!(await t.check()); } catch { present = false; }
    if (present) {
      console.log(`[ok]   ${t.label}`);
    } else {
      console.log(`[need] ${t.label}`);
      missing.push(t);
    }
  }
  if (!missing.length) {
    console.log('all tools present.');
    return { ok: true, installed: [] };
  }

  const rl = readline.createInterface({ input, output });
  const installed = [];
  try {
    for (const t of missing) {
      const cmd = installCmd(t.id);
      if (!cmd) {
        console.log(`[skip] ${t.label}: no automatic install command. install manually.`);
        continue;
      }
      let proceed = yes;
      if (!yes) {
        const ans = await rl.question(`install ${t.label} via "${cmd[0]} ${cmd[1].join(' ')}"? [y/N] `);
        proceed = /^y(es)?$/i.test(ans.trim());
      }
      if (!proceed) {
        console.log(`[skip] ${t.label}`);
        continue;
      }
      if (dryRun) {
        console.log(`[dry-run] would run: ${cmd[0]} ${cmd[1].join(' ')}`);
        installed.push(t.id);
        continue;
      }
      try {
        console.log(`[run]  ${cmd[0]} ${cmd[1].join(' ')}`);
        await ex(cmd[0], cmd[1], { stdio: 'inherit' });
        installed.push(t.id);
      } catch (e) {
        console.error(`[fail] ${t.label}: ${e.message}`);
      }
    }
  } finally {
    rl.close();
  }
  return { ok: installed.length === missing.length, installed };
}
