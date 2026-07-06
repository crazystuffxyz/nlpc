// doctor - verifies the local toolchain
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';

const ex = promisify(execFile);

async function check(label, fn) {
  try {
    const v = await fn();
    console.log(`[ok] ${label}: ${v}`);
    return { label, ok: true, info: v };
  } catch (e) {
    console.log(`[fail] ${label}: ${e.message}`);
    return { label, ok: false, err: e.message };
  }
}

export async function doctor(cfg) {
  const results = [];
  results.push(await check('node', async () => process.version));
  results.push(await check(cfg.cxx, async () => {
    const { stdout } = await ex(cfg.cxx, ['--version']);
    return stdout.split('\n')[0];
  }));
  results.push(await check('cmake', async () => {
    const { stdout } = await ex(cfg.cmake, ['--version']);
    return stdout.split('\n')[0];
  }));
  const vroot = cfg.vcpkgRoot;
  if (vroot && existsSync(vroot)) {
    results.push({ label: 'vcpkg', ok: true, info: vroot });
    results.push(await check('vcpkg binary', async () => {
      const bin = process.platform === 'win32' ? 'vcpkg.exe' : 'vcpkg';
      const { stdout } = await ex(resolve(vroot, bin), ['--version']);
      return stdout.split('\n')[0];
    }));
  } else {
    results.push({ label: 'vcpkg', ok: false, err: `set VCPKG_ROOT or pass --vcpkg-root (got: ${vroot})` });
  }
  results.push(await check('ollama', async () => {
    const r = await fetch(`${cfg.ollamaHost}/api/version`);
    if (!r.ok) throw new Error(`http ${r.status}`);
    const j = await r.json();
    return j.version || 'unknown';
  }));
  for (const r of results) {
    const tag = r.ok ? chalk.green('[ok]') : chalk.red('[FAIL]');
    console.log(`${tag} ${r.label}: ${r.info || r.err}`);
  }
  return results.every(r => r.ok);
}
