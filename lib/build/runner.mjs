// build runner - executes cmake/g++ with safety
import { spawn } from 'node:child_process'; // spawn
import { promisify } from 'node:util'; // util
import { existsSync } from 'node:fs'; // fs
import { resolve, join, isAbsolute } from 'node:path'; // path

console.log('build/runner.mjs load'); // trace

// allowlist of binaries
const SAFE_BINS = new Set(['cmake', 'g++', 'clang++', 'cl', 'ninja', 'make', 'vcpkg', 'vcpkg.exe']); // bins

export async function run(cmd, args, opts = {}) { // generic run
  console.log('run', cmd, args.slice(0, 3), '...'); // trace
  if (!SAFE_BINS.has(cmd) && !isAbsolute(cmd)) { // not allowed
    throw new Error(`refusing to run non-allowlisted binary: ${cmd}`); // reject
  }
  return new Promise((res, rej) => { // promise
    const child = spawn(cmd, args, { ...opts, shell: false, windowsHide: true }); // spawn
    let stdout = ''; // out
    let stderr = ''; // err
    child.stdout.on('data', d => { stdout += d.toString(); if (opts.onStdout) opts.onStdout(d.toString()); }); // data
    child.stderr.on('data', d => { stderr += d.toString(); if (opts.onStderr) opts.onStderr(d.toString()); }); // data
    child.on('error', rej); // err
    child.on('close', code => { // close
      if (code === 0) res({ code, stdout, stderr }); // ok
      else { // fail
        const e = new Error(`${cmd} exited with code ${code}`); // err
        e.code = code; e.stdout = stdout; e.stderr = stderr; e.cmd = cmd; e.args = args; // attach
        rej(e); // rej
      }
    });
  });
}

export async function ensureVcpkg(cfg) { // bootstrap vcpkg
  console.log('ensureVcpkg', cfg.vcpkgRoot); // trace
  if (cfg.vcpkgRoot && existsSync(cfg.vcpkgRoot)) { // exists
    const bin = process.platform === 'win32' ? 'vcpkg.exe' : 'vcpkg'; // bin
    const p = resolve(cfg.vcpkgRoot, bin); // path
    if (existsSync(p)) return p; // ok
  }
  throw new Error(`vcpkg not found. Set VCPKG_ROOT or pass --vcpkg-root`); // fail
}

export async function vcpkgInstall(workdir, cfg) { // install deps
  console.log('vcpkgInstall', workdir); // trace
  const vcpkgBin = await ensureVcpkg(cfg); // get
  const toolchain = resolve(cfg.vcpkgRoot, 'scripts', 'buildsystems', 'vcpkg.cmake'); // toolchain
  if (!existsSync(toolchain)) throw new Error(`vcpkg toolchain missing: ${toolchain}`); // missing
  // first, just run `vcpkg install` in manifest mode - this populates vcpkg_installed/
  try { // try
    await run(vcpkgBin, ['install', '--x-install-root=' + resolve(workdir, 'vcpkg_installed')], { cwd: workdir, timeout: cfg.timeoutMs }); // install
  } catch (e) { // fail
    console.error('vcpkg install err', e.stderr?.slice(0, 500)); // log
    throw e; // throw
  }
  return { toolchain, vcpkgBin };
}

export async function cmakeConfigure(workdir, cfg, opts = {}) { // cmake config
  console.log('cmakeConfigure', workdir); // trace
  const toolchain = resolve(cfg.vcpkgRoot, 'scripts', 'buildsystems', 'vcpkg.cmake'); // toolchain
  const buildDir = resolve(workdir, 'build'); // build dir
  const args = [ // args
    '-S', workdir, // src
    '-B', buildDir, // build
    '-G', cfg.generator || 'Ninja', // generator
    '-DCMAKE_BUILD_TYPE=' + (cfg.buildType || 'Release'), // type
    '-DCMAKE_TOOLCHAIN_FILE=' + toolchain, // toolchain
  ];
  if (opts.cxx) args.push('-DCMAKE_CXX_COMPILER=' + opts.cxx); // cxx
  return run(cfg.cmake, args, { cwd: workdir, timeout: cfg.timeoutMs }); // run
}

export async function cmakeBuild(workdir, cfg) { // build
  console.log('cmakeBuild', workdir); // trace
  const buildDir = resolve(workdir, 'build'); // dir
  return run(cfg.cmake, ['--build', buildDir, '--config', cfg.buildType || 'Release'], { cwd: workdir, timeout: cfg.timeoutMs }); // run
}
