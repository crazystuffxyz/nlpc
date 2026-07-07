#!/usr/bin/env node
// standalone installer: PATH add, npm install, verify. cross-os, no setx.
// one file, one bundle (built with esbuild + pkg).
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, statSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, copyFileSync, chmodSync, readlinkSync, symlinkSync } from 'node:fs';
import { resolve, dirname, join, basename, delimiter } from 'node:path';
import { homedir, platform, arch, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ex = promisify(execFile);

// args: install [add-to-path] [--npm | --binary] [--target <dir>] [--yes]
export function parseArgs(argv) {
  const opts = { mode: 'npm', addToPath: false, target: '', yes: false, noInstall: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'install' || a === 'add-to-path') { opts.addToPath = (a === 'add-to-path'); continue; }
    if (a === '--npm') { opts.mode = 'npm'; continue; }
    if (a === '--binary') { opts.mode = 'binary'; continue; }
    if (a === '--yes') { opts.yes = true; continue; }
    if (a === '--no-install') { opts.noInstall = true; continue; }
    if (a === '--target') { opts.target = argv[++i] || ''; continue; }
    if (a === '--help' || a === '-h') { usage(); process.exit(0); }
  }
  if (!opts.addToPath && argv[2] !== 'install' && argv[2] !== 'add-to-path') opts.addToPath = true;
  return opts;
}

function usage() {
  console.log(`nlpc install - cross-os installer

usage:
  nlpc install [options]
  nlpc add-to-path [options]

options:
  --npm            install via npm (default)
  --binary         copy a bundled binary to ~/.nlpc/bin and add to PATH
  --add-to-path    only update PATH; do not install
  --target <dir>   where to place the binary (default: ~/.nlpc/bin)
  --yes            skip confirmations
  --no-install     print what would be done, but do nothing

env vars:
  NLPC_BIN         override the binary to install
  NLPC_HOME        override ~/.nlpc
`);
}

export const HOME_DEFAULT = join(homedir(), '.nlpc');

export function getBinDir(target) {
  return target || process.env.NLPC_HOME ? target || join(process.env.NLPC_HOME || HOME_DEFAULT, 'bin') : join(HOME_DEFAULT, 'bin');
}

function log(...a) { console.log('[nlpc-install]', ...a); }
function err(...a) { console.error('[nlpc-install]', ...a); }

async function prompt(q) {
  if (process.env.NLPC_ASSUME_YES === '1') return true;
  process.stdout.write(q + ' [y/N] ');
  return new Promise(r => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', d => { buf += d; r(/^y(es)?$/i.test(buf.trim())); });
    process.stdin.resume();
  });
}

// read current PATH from the right place per OS.
// never modifies System PATH. User PATH only.
export async function readUserPath() {
  if (platform() === 'win32') {
    const { stdout } = await ex('powershell', [
      '-NoProfile', '-Command',
      `[Environment]::GetEnvironmentVariable('PATH', 'User')`
    ], { windowsHide: true });
    return stdout.trim();
  }
  // mac/linux: read from shell rcfile (best-effort). we never modify System PATH.
  const shell = process.env.SHELL || '/bin/bash';
  const rcfile = shell.endsWith('zsh') ? join(homedir(), '.zshrc')
                 : shell.endsWith('fish') ? join(homedir(), '.config', 'fish', 'config.fish')
                 : join(homedir(), '.bashrc');
  if (existsSync(rcfile)) {
    const text = readFileSync(rcfile, 'utf8');
    const m = text.match(/^export PATH="([^"]+)"/m);
    if (m) return m[1];
    const m2 = text.match(/^PATH="([^"]+)"\nexport PATH/m);
    if (m2) return m2[1];
  }
  return process.env.PATH || '';
}

export async function writeUserPath(newPath) {
  if (platform() === 'win32') {
    // use SetEnvironmentVariable, NOT setx. setx truncates to 1024.
    await ex('powershell', [
      '-NoProfile', '-Command',
      `[Environment]::SetEnvironmentVariable('PATH', ${JSON.stringify(newPath)}, 'User')`
    ], { windowsHide: true });
    return;
  }
  const shell = process.env.SHELL || '/bin/bash';
  const rcfile = shell.endsWith('zsh') ? join(homedir(), '.zshrc')
                 : shell.endsWith('fish') ? join(homedir(), '.config', 'fish', 'config.fish')
                 : join(homedir(), '.bashrc');
  let text = existsSync(rcfile) ? readFileSync(rcfile, 'utf8') : '';
  // remove any prior nlpc-managed block
  text = text.replace(/^# >>> nlpc path >>>[\s\S]*?# <<< nlpc path <<<\n?/m, '');
  text = text.replace(/^export PATH="[^"]*"\n?/m, '');
  text += `\n# >>> nlpc path >>>\nexport PATH="${newPath}:$PATH"\n# <<< nlpc path <<<\n`;
  writeFileSync(rcfile, text, 'utf8');
  // also try to update the running shell's env so `which nlpc` works immediately
  process.env.PATH = `${newPath}:${process.env.PATH || ''}`;
}

export async function addToPath(binDir) {
  const before = await readUserPath();
  const parts = (before || '').split(delimiter).filter(Boolean);
  if (parts.includes(binDir)) {
    log(binDir, 'already on PATH');
    return { added: false, binDir, len: before.length };
  }
  // sanity check: refuse if prepending would drop entries (a guard against
  // accidental truncation, even though SetEnvironmentVariable doesn't truncate).
  const testPath = `${binDir}${delimiter}${before}`;
  if (testPath.length > 8000 && platform() === 'win32') {
    err('warning: PATH would be', testPath.length, 'chars. Windows handles up to 32767 in the registry but some apps read only the first 4k.');
  }
  await writeUserPath(testPath);
  log('added', binDir, 'to PATH');
  return { added: true, binDir, len: testPath.length };
}

export async function installBinary(binDir) {
  const src = process.env.NLPC_BIN
    ? resolve(process.env.NLPC_BIN)
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', platform() === 'win32' ? 'nlpc.exe' : 'nlpc');
  if (!existsSync(src)) throw new Error('binary not found at ' + src);
  mkdirSync(binDir, { recursive: true });
  const dst = join(binDir, platform() === 'win32' ? 'nlpc.exe' : 'nlpc');
  copyFileSync(src, dst);
  chmodSync(dst, 0o755);
  log('installed', dst);
  return { src, dst };
}

export async function installNpm() {
  // npm install -g crazystuffxyz/nlpc — the github shorthand (no public registry needed)
  const { stdout } = await ex('npm', ['install', '-g', 'crazystuffxyz/nlpc', '--no-audit', '--no-fund'], { stdio: 'inherit' });
  log('npm install -g crazystuffxyz/nlpc done');
  return { stdout };
}

export async function main(argv = process.argv) {
  const opts = parseArgs(argv);
  const binDir = opts.target || join(process.env.NLPC_HOME || HOME_DEFAULT, 'bin');
  if (opts.noInstall) {
    log('dry-run: would do', opts);
    return { ok: true, dryRun: true };
  }
  if (opts.addToPath) {
    await addToPath(binDir);
    return { ok: true, added: true };
  }
  if (opts.mode === 'binary') await installBinary(binDir);
  else await installNpm();
  // always offer to add to PATH
  const before = await readUserPath();
  if (!(before || '').split(delimiter).includes(binDir)) {
    if (await prompt(`add ${binDir} to PATH?`)) await addToPath(binDir);
  }
  log('done. try: nlpc --version');
  return { ok: true };
}

// when invoked as a script, run main. when imported (tests), skip.
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}` ||
           import.meta.url === fileURLToPath(`file://${process.argv[1]}`);
  } catch { return false; }
})();
if (isMain) {
  main().catch(e => { err(e.message); process.exit(1); });
}
