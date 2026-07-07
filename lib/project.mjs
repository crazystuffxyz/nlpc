// project - multi-file build via nlpc.toml
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join, basename, extname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { run } from './runner.mjs';
import { slug } from './runtime/slug.mjs';

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

  // disambiguate workdirs: src/api/main.nlp and src/worker/main.nlp both
  // slug to "main", which would cause parallel rmSync/mkdirSync to collide.
  // we pass a unique outDir per entry (slug + short hash of the relpath) so
  // each run() gets a guaranteed-isolated working directory.
  const compileOne = async (file) => {
    const name = basename(file, '.nlp');
    const rel = relative(absDir, file).replace(/\\/g, '/');
    const tag = createHash('sha1').update(rel).digest('hex').slice(0, 6);
    const entryOut = resolve(outDir, `${slug(name)}_${tag}`);
    if (spinner) spinner.text = `compiling ${rel}`;
    const r = await run({
      file,
      opts: { ...opts, out: entryOut, noLlm: true, repair: opts.repair !== false },
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
