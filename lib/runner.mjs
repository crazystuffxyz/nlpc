// runner - orchestrates the full pipeline
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'; // fs
import { resolve, join, basename, extname } from 'node:path'; // path
import { parseStructured } from './parser/structured.mjs'; // parser
import { chunkProse } from './parser/prose.mjs'; // prose
import { buildIR } from './ir/builder.mjs'; // ir builder
import { validateIR } from './ir/validator.mjs'; // validator
import { LLM } from './llm/ollama.mjs'; // llm
import { resolveRequirements, lookup } from './deps/resolver.mjs'; // deps
import { emitCpp, setReqFmt } from './codegen/emit.mjs'; // codegen
import { emitProject } from './codegen/cmake.mjs'; // cmake
import { vcpkgInstall, cmakeConfigure, cmakeBuild } from './build/runner.mjs'; // build (renamed to avoid collision)
import { repairLoop } from './build/repair.mjs'; // repair

console.log('runner.mjs load'); // trace

export async function run({ file, opts, cfg, spinner, runAfter = false }) { // main
  console.log('runner.run file', file); // trace
  const t0 = Date.now(); // start
  // 1. read
  if (spinner) spinner.text = 'reading .nlp'; // spinner
  const text = readFileSync(file, 'utf8'); // read
  console.log('read bytes', text.length); // trace
  // 2. parse
  if (spinner) spinner.text = 'parsing'; // spinner
  const { blocks, prose } = parseStructured(text); // parse
  console.log('blocks', blocks.length, 'prose', prose.length); // trace
  // 3. ir
  if (spinner) spinner.text = 'building IR'; // spinner
  let ir; // init
  let llm = null; // llm handle
  if (opts.noLlm || process.env.NLPC_OFFLINE === '1') { // offline
    ir = buildIR(blocks, prose, basename(file, extname(file))); // build direct
  } else {
    // try offline first; if no behaviors, try llm
    try { ir = buildIR(blocks, prose, basename(file, extname(file))); } // direct
    catch (e) { // need llm
      console.log('structured path failed, trying llm:', e.message); // log
      llm = new LLM(cfg); // llm
      const ping = await llm.ping(); // ping
      if (!ping.ok) throw new Error('ollama not reachable: ' + ping.err + '. set NLPC_OFFLINE=1 to use structured-only.'); // fail
      ir = await llm.extractIR(blocks, prose); // extract
      if (ir.requirements) { // resolve
        for (const r of ir.requirements) { // loop
          if (r.source === 'vcpkg' && !lookup(r.name)) { // unknown
            try { const m = await llm.resolveUnknownDep(r.name); if (m?.vcpkg) r.name = m.vcpkg; } // resolve
            catch { /* leave as is, will fail later */ }
          }
        }
      }
      const v = validateIR(ir); // validate
      if (!v.ok) throw new Error('llm ir invalid: ' + v.errors.map(e => e.path + ' ' + e.msg).join('; '));
    }
  }
  console.log('ir built, program', ir.program.name, ir.program.kind); // trace
  // sanity: must have at least one behavior or one declaration
  if (ir.behaviors.length === 0 && ir.declarations.length === 0) {
    throw new Error('ir empty: program has no behaviors and no declarations; an LLM is required to interpret free-form prose (set NLPC_OFFLINE=0 and ensure ollama is running)');
  }
  // 4. workdir
  const outRoot = resolve(process.cwd(), opts.out || 'build-out'); // out root
  const workdir = resolve(outRoot, ir.program.name); // per-program dir
  if (!opts.keepBuild && existsSync(workdir)) { // wipe
    rmSync(workdir, { recursive: true, force: true });
  }
  mkdirSync(workdir, { recursive: true }); // mkdir
  // 5. write ir
  writeFileSync(join(workdir, 'ir.json'), JSON.stringify(ir, null, 2), 'utf8'); // write
  // 6. resolve deps
  if (spinner) spinner.text = 'resolving dependencies'; // spinner
  const deps = resolveRequirements(ir.requirements || []); // resolve
  console.log('deps', deps.packages, 'unknown', deps.unknown); // trace
  for (const u of deps.unknown) { // unknown
    if (llm) { // have llm
      try { const m = await llm.resolveUnknownDep(u); if (m?.vcpkg) { ir.requirements.push({ name: m.vcpkg, source: 'vcpkg' }); } } // try
      catch { /* ignore */ }
    }
  }
  // 7. codegen
  if (spinner) spinner.text = 'generating C++'; // spinner
  setReqFmt((ir.requirements || []).some(r => /fmt/i.test(r.name))); // fmt flag
  const cpp = emitCpp(ir); // emit
  writeFileSync(join(workdir, 'main.cpp'), cpp, 'utf8'); // write
  const { cmake, vcpkg, name, packages } = emitProject(ir, ir.program.name); // emit
  writeFileSync(join(workdir, 'CMakeLists.txt'), cmake, 'utf8'); // write
  writeFileSync(join(workdir, 'vcpkg.json'), vcpkg, 'utf8'); // write
  console.log('codegen done:', packages.length, 'packages'); // trace
  // 8. install deps
  if (spinner) spinner.text = 'installing dependencies (vcpkg)'; // spinner
  try { await vcpkgInstall(workdir, cfg); } catch (e) { console.error('vcpkg install err', e.stderr?.slice(0, 800)); throw e; } // install
  // 9. configure
  if (spinner) spinner.text = 'cmake configure'; // spinner
  try { await cmakeConfigure(workdir, cfg); } catch (e) { console.error('cmake configure err', e.stderr?.slice(0, 800)); throw e; } // config
  // 10. build (with repair)
  if (spinner) spinner.text = 'compiling'; // spinner
  if (opts.repair === false || process.env.NLPC_OFFLINE === '1') { // no repair
    try { await cmakeBuild(workdir, cfg); } // build
    catch (e) { throw new Error('compile failed: ' + (e.stderr || '').slice(0, 2000)); } // fail loud
  } else {
    try { // try
      await repairLoop({ workdir, ir, llm, cfg, onAttempt: (n) => { if (spinner) spinner.text = `compiling (repair ${n}/${cfg.repairMax})`; } });
    } catch (e) { throw new Error('compile failed: ' + e.message); }
  }
  // 11. binary
  const ext = process.platform === 'win32' ? '.exe' : ''; // ext
  const binary = resolve(workdir, 'build', name + ext); // binary path
  if (!existsSync(binary)) { // not found
    // ninja puts it in build/ with possible Debug/Release subdir
    const alt = resolve(workdir, 'build', cfg.buildType || 'Release', name + ext); // alt
    if (existsSync(alt)) return { binary: alt, workdir, ir, cpp, ms: Date.now() - t0 }; // ok
    throw new Error('binary not found at ' + binary); // fail
  }
  console.log('compile complete in', Date.now() - t0, 'ms'); // trace
  if (runAfter) { // run
    const { execFileSync } = await import('node:child_process'); // import
    try { const out = execFileSync(binary, { stdio: 'inherit' }); } // run
    catch (e) { console.error('run err', e.message); throw e; } // fail
  }
  return { binary, workdir, ir, cpp, ms: Date.now() - t0 }; // return
}

// export helpers for tests
export { parseStructured, buildIR, emitCpp, emitProject, resolveRequirements, validateIR, repairLoop, vcpkgInstall, cmakeConfigure, cmakeBuild };
