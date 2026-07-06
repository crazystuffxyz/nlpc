// build runner - executes cmake/g++ with safety
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';

// allowlist of binaries
const SAFE_BINS = new Set(['cmake', 'g++', 'clang++', 'cl', 'ninja', 'make', 'vcpkg', 'vcpkg.exe']);

export async function run(cmd, args, opts = {}) {
  if (!SAFE_BINS.has(cmd) && !isAbsolute(cmd)) {
    throw new Error(`refusing to run non-allowlisted binary: ${cmd}`);
  }
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { ...opts, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); if (opts.onStdout) opts.onStdout(d.toString()); });
    child.stderr.on('data', d => { stderr += d.toString(); if (opts.onStderr) opts.onStderr(d.toString()); });
    child.on('error', rej);
    child.on('close', code => {
      if (code === 0) res({ code, stdout, stderr });
      else {
        const e = new Error(`${cmd} exited with code ${code}`);
        e.code = code; e.stdout = stdout; e.stderr = stderr; e.cmd = cmd; e.args = args;
        rej(e);
      }
    });
  });
}

export async function ensureVcpkg(cfg) {
  if (cfg.vcpkgRoot && existsSync(cfg.vcpkgRoot)) {
    const bin = process.platform === 'win32' ? 'vcpkg.exe' : 'vcpkg';
    const p = resolve(cfg.vcpkgRoot, bin);
    if (existsSync(p)) return p;
  }
  throw new Error(`vcpkg not found. Set VCPKG_ROOT or pass --vcpkg-root`);
}

export async function vcpkgInstall(workdir, cfg) {
  const vcpkgBin = await ensureVcpkg(cfg);
  const toolchain = resolve(cfg.vcpkgRoot, 'scripts', 'buildsystems', 'vcpkg.cmake');
  if (!existsSync(toolchain)) throw new Error(`vcpkg toolchain missing: ${toolchain}`);
  // first, just run `vcpkg install` in manifest mode - this populates vcpkg_installed/
  try {
    await run(vcpkgBin, ['install', '--x-install-root=' + resolve(workdir, 'vcpkg_installed')], { cwd: workdir, timeout: cfg.timeoutMs });
  } catch (e) {
    console.error('vcpkg install err', e.stderr?.slice(0, 500));
    throw e;
  }
  return { toolchain, vcpkgBin };
}

export async function cmakeConfigure(workdir, cfg, opts = {}) {
  const toolchain = resolve(cfg.vcpkgRoot, 'scripts', 'buildsystems', 'vcpkg.cmake');
  const buildDir = resolve(workdir, 'build');
  const args = [
    '-S', workdir,
    '-B', buildDir,
    '-G', cfg.generator || 'Ninja',
    '-DCMAKE_BUILD_TYPE=' + (cfg.buildType || 'Release'),
    '-DCMAKE_TOOLCHAIN_FILE=' + toolchain,
  ];
  if (opts.cxx) args.push('-DCMAKE_CXX_COMPILER=' + opts.cxx);
  return run(cfg.cmake, args, { cwd: workdir, timeout: cfg.timeoutMs });
}

export async function cmakeBuild(workdir, cfg) {
  const buildDir = resolve(workdir, 'build');
  return run(cfg.cmake, ['--build', buildDir, '--config', cfg.buildType || 'Release'], { cwd: workdir, timeout: cfg.timeoutMs });
}
