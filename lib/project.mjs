// project - multi-file build via nlpc.toml
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join, basename, extname, relative } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { run } from './runner.mjs';

const PROJECT_FILE = 'nlpc.toml';

// smol-toml is a spec-compliant TOML parser (~20KB, zero deps, BSD-3).
// it returns the same shape the rest of this file expects: { project, build, entries }.
function loadToml(text) {
  return parseToml(text);
}

export function loadProject(dir) {
  const p = resolve(dir, PROJECT_FILE);
  if (!existsSync(p)) return null;
  return loadToml(readFileSync(p, 'utf8'));
}

// find .nlp files. if config has [[entries]], use that. otherwise discover.
export function discoverEntries(dir, project) {
  if (project && project.entries && project.entries.length) {
    return project.entries
      .filter(e => e.file)
      .map(e => resolve(dir, e.file));
  }
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      const s = statSync(p);
      if (s.isDirectory()) { if (f !== 'build-out' && f !== 'node_modules' && f !== '.git') walk(p); }
      else if (extname(f) === '.nlp') out.push(p);
    }
  };
  walk(resolve(dir));
  return out.sort();
}

export async function buildProject({ dir, opts, cfg, spinner, parallel = true }) {
  const absDir = resolve(dir);
  const project = loadProject(absDir);
  const projectName = project?.project?.name || basename(absDir);
  const outDir = resolve(absDir, opts.out || 'build-out');
  const entries = discoverEntries(absDir, project);
  if (!entries.length) throw new Error('no .nlp entries found in ' + absDir);

  const compileOne = async (file) => {
    const name = basename(file, '.nlp');
    if (spinner) spinner.text = `compiling ${name}`;
    const r = await run({
      file,
      opts: { ...opts, out: outDir, noLlm: true, repair: opts.repair !== false },
      cfg,
      spinner: null,
      runAfter: false,
    });
    return { file, name, binary: r.binary, ok: true };
  };

  let results;
  if (parallel && entries.length > 1) {
    results = await Promise.all(entries.map(compileOne));
  } else {
    results = [];
    for (const f of entries) results.push(await compileOne(f));
  }

  const failed = results.filter(r => !r.ok);
  if (failed.length) throw new Error(`${failed.length}/${results.length} entries failed`);
  return { projectName, outDir, entries: results, manifests: { project } };
}
