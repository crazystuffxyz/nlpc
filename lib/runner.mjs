// runner - orchestrates the full pipeline
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import { parseStructured } from './parser/structured.mjs';
import { chunkProse } from './parser/prose.mjs';
import { buildIR } from './ir/builder.mjs';
import { validateIR } from './ir/validator.mjs';
import { LLM } from './llm/ollama.mjs';
import { pickModel } from './llm/pick.mjs';
import { resolveRequirements, lookup, allowlist } from './deps/resolver.mjs';
import { emitCpp } from './codegen/emit.mjs';
import { emitProject } from './codegen/cmake.mjs';
import { vcpkgInstall, cmakeConfigure, cmakeBuild } from './build/runner.mjs';
import { repairLoop } from './build/repair.mjs';
import { slug } from './runtime/slug.mjs';

export async function run({ file, opts, cfg, spinner, runAfter = false }) {
  const t0 = Date.now();
  // 1. read
  if (spinner) spinner.text = 'reading .nlp';
  const text = readFileSync(file, 'utf8');
  // 2. parse
  if (spinner) spinner.text = 'parsing';
  const { blocks, prose } = parseStructured(text);
  // 3. ir
  if (spinner) spinner.text = 'building IR';
  let ir;
  let llm = null;
  if (opts.noLlm || process.env.NLPC_OFFLINE === '1') {
    ir = buildIR(blocks, prose, basename(file, extname(file)));
  } else {
    // try offline first; if no behaviors, try llm
    try { ir = buildIR(blocks, prose, basename(file, extname(file))); }
    catch (e) {
      if (!cfg.model) cfg.model = await pickModel(cfg.ollamaHost);
      llm = new LLM(cfg);
      const ping = await llm.ping();
      if (!ping.ok) throw new Error('ollama not reachable: ' + ping.err + '. set NLPC_OFFLINE=1 to use structured-only.');
      ir = await llm.extractIR(blocks, prose);
      if (ir.requirements) {
        const allowed = new Set(allowlist());
        for (const r of ir.requirements) {
          if (r.source === 'vcpkg' && !lookup(r.name)) {
            try {
              const m = await llm.resolveUnknownDep(r.name);
              if (m?.vcpkg && allowed.has(m.vcpkg)) r.name = m.vcpkg;
              else r.source = 'unsupported'; // mark for skip in resolveRequirements
            } catch { r.source = 'unsupported'; }
          }
        }
      }
      const v = validateIR(ir);
      if (!v.ok) throw new Error('llm ir invalid: ' + v.errors.map(e => e.path + ' ' + e.msg).join('; '));
    }
  }
  // sanity: must have at least one behavior or one declaration
  if (ir.behaviors.length === 0 && ir.declarations.length === 0) {
    throw new Error('ir empty: program has no behaviors and no declarations; an LLM is required to interpret free-form prose (set NLPC_OFFLINE=0 and ensure ollama is running)');
  }
  // sanitize program.name. the LLM (or a prompt-injection in prose) can return
  // a name like '../../../../../' which would make workdir resolve to the
  // filesystem root and the rmSync below would wipe the system. slug() forces
  // it to [a-z0-9_]+.
  ir.program.name = slug(ir.program.name);
  // 4. workdir
  const outRoot = resolve(process.cwd(), opts.out || 'build-out');
  const workdir = resolve(outRoot, ir.program.name);
  if (!opts.keepBuild && existsSync(workdir)) {
    rmSync(workdir, { recursive: true, force: true });
  }
  mkdirSync(workdir, { recursive: true });
  // 5. write ir
  writeFileSync(join(workdir, 'ir.json'), JSON.stringify(ir, null, 2), 'utf8');
  // 6. resolve deps
  if (spinner) spinner.text = 'resolving dependencies';
  const deps = resolveRequirements(ir.requirements || []);
  const allowed = new Set(allowlist());
  for (const u of deps.unknown) {
    if (llm) {
      try {
        const m = await llm.resolveUnknownDep(u);
        // guard: only accept vcpkg names we know how to link. anything else
        // gets dropped (and warned) - the repair loop can't fix a missing
        // target_link_libraries entry, and vcpkg would install a port we
        // can't consume.
        if (m?.vcpkg && allowed.has(m.vcpkg)) {
          ir.requirements.push({ name: m.vcpkg, source: 'vcpkg' });
        } else if (m?.vcpkg) {
          console.error(`[nlpc] dropping unknown vcpkg port from LLM: "${m.vcpkg}" (not in allowlist; required for: ${u})`);
        } else {
          console.error(`[nlpc] no vcpkg port found for "${u}" - skipping`);
        }
      } catch (e) {
        console.error(`[nlpc] LLM dep resolution failed for "${u}":`, e.message);
      }
    } else {
      console.error(`[nlpc] unknown requirement "${u}" - not in library map. set NLPC_OFFLINE=0 with ollama running to let the LLM resolve.`);
    }
  }
  // 7. codegen
  if (spinner) spinner.text = 'generating C++';
  const cpp = emitCpp(ir);
  writeFileSync(join(workdir, 'main.cpp'), cpp, 'utf8');
  const { cmake, vcpkg, name, packages } = emitProject(ir, ir.program.name);
  writeFileSync(join(workdir, 'CMakeLists.txt'), cmake, 'utf8');
  writeFileSync(join(workdir, 'vcpkg.json'), vcpkg, 'utf8');
  // 8. install deps
  if (spinner) spinner.text = 'installing dependencies (vcpkg)';
  try { await vcpkgInstall(workdir, cfg); } catch (e) { console.error('vcpkg install err', e.stderr?.slice(0, 800)); throw e; }
  // 9. configure
  if (spinner) spinner.text = 'cmake configure';
  try { await cmakeConfigure(workdir, cfg); } catch (e) { console.error('cmake configure err', e.stderr?.slice(0, 800)); throw e; }
  // 10. build (with repair)
  if (spinner) spinner.text = 'compiling';
  if (opts.repair === false || process.env.NLPC_OFFLINE === '1') {
    try { await cmakeBuild(workdir, cfg); }
    catch (e) { throw new Error('compile failed: ' + (e.stderr || '').slice(0, 2000)); }
  } else {
    try {
      await repairLoop({ workdir, ir, llm, cfg, onAttempt: (n) => { if (spinner) spinner.text = `compiling (repair ${n}/${cfg.repairMax})`; } });
    } catch (e) { throw new Error('compile failed: ' + e.message); }
  }
  // 11. binary
  const ext = process.platform === 'win32' ? '.exe' : '';
  const binary = resolve(workdir, 'build', name + ext);
  if (!existsSync(binary)) {
    // ninja puts it in build/ with possible Debug/Release subdir
    const alt = resolve(workdir, 'build', cfg.buildType || 'Release', name + ext);
    if (existsSync(alt)) return { binary: alt, workdir, ir, cpp, ms: Date.now() - t0 };
    throw new Error('binary not found at ' + binary);
  }
  if (runAfter) {
    const { execFileSync } = await import('node:child_process');
    try { const out = execFileSync(binary, { stdio: 'inherit' }); }
    catch (e) { console.error('run err', e.message); throw e; }
  }
  return { binary, workdir, ir, cpp, ms: Date.now() - t0 };
}

// export helpers for tests
export { parseStructured, buildIR, emitCpp, emitProject, resolveRequirements, validateIR, repairLoop, vcpkgInstall, cmakeConfigure, cmakeBuild };
