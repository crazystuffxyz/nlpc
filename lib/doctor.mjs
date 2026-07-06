// doctor - verifies the local toolchain
import { execFile } from 'node:child_process'; // exec
import { promisify } from 'node:util'; // util
import { existsSync } from 'node:fs'; // fs
import { resolve } from 'node:path'; // path
import chalk from 'chalk'; // color

const ex = promisify(execFile); // promise wrap
console.log('doctor.mjs load'); // trace

async function check(label, fn) { // generic check
  try { const v = await fn(); console.log(`[ok] ${label}: ${v}`); return { label, ok: true, info: v }; } // ok
  catch (e) { console.log(`[fail] ${label}: ${e.message}`); return { label, ok: false, err: e.message }; } // fail
}

export async function doctor(cfg) { // main
  console.log('doctor run'); // trace
  const results = []; // collect
  results.push(await check('node', async () => process.version)); // node
  results.push(await check(cfg.cxx, async () => { // compiler
    const { stdout } = await ex(cfg.cxx, ['--version']); // version
    return stdout.split('\n')[0]; // first line
  }));
  results.push(await check('cmake', async () => { // cmake
    const { stdout } = await ex(cfg.cmake, ['--version']); // version
    return stdout.split('\n')[0];
  }));
  const vroot = cfg.vcpkgRoot; // vcpkg path
  if (vroot && existsSync(vroot)) { // exists
    results.push({ label: 'vcpkg', ok: true, info: vroot }); // ok
    results.push(await check('vcpkg binary', async () => { // vcpkg exe
      const bin = process.platform === 'win32' ? 'vcpkg.exe' : 'vcpkg'; // bin name
      const { stdout } = await ex(resolve(vroot, bin), ['--version']); // version
      return stdout.split('\n')[0];
    }));
  } else {
    results.push({ label: 'vcpkg', ok: false, err: `set VCPKG_ROOT or pass --vcpkg-root (got: ${vroot})` });
  }
  results.push(await check('ollama', async () => { // ollama
    const r = await fetch(`${cfg.ollamaHost}/api/version`); // ping
    if (!r.ok) throw new Error(`http ${r.status}`); // bad
    const j = await r.json(); // parse
    return j.version || 'unknown'; // return
  }));
  for (const r of results) { // print
    const tag = r.ok ? chalk.green('[ok]') : chalk.red('[FAIL]'); // tag
    console.log(`${tag} ${r.label}: ${r.info || r.err}`); // log
  }
  return results.every(r => r.ok); // all ok
}
