// watch - recompile + rerun when the .nlp file changes
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { run } from './runner.mjs';
import { loadConfig } from './config.mjs';
import chalk from 'chalk';

const DEBOUNCE_MS = 200;

export async function watchFile({ file, opts, cfg, spinner }) {
  const abspath = file;
  let timer = null;
  let proc = null;
  let building = false;
  let pending = false;
  let stopped = false;

  const kill = () => {
    if (proc && !proc.killed) {
      try { proc.kill(); } catch {}
      proc = null;
    }
  };

  const build = async () => {
    if (building) { pending = true; return; }
    building = true;
    kill();
    if (spinner) spinner.text = 'rebuilding';
    try {
      const res = await run({ file: abspath, opts, cfg, spinner, runAfter: false });
      if (spinner) spinner.succeed(`built ${res.binary}`);
      if (!stopped && opts.run !== false) {
        proc = spawn(res.binary, [], { stdio: 'inherit', windowsHide: true });
        proc.on('exit', (code) => {
          if (!stopped && code !== 0 && spinner) spinner.fail(`exited ${code}`);
        });
      }
    } catch (e) {
      if (spinner) spinner.fail(chalk.red(e.message));
    } finally {
      building = false;
      if (pending) { pending = false; setTimeout(build, 0); }
    }
  };

  const onChange = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(build, DEBOUNCE_MS);
  };

  process.on('SIGINT', () => { stopped = true; kill(); process.exit(0); });
  process.on('SIGTERM', () => { stopped = true; kill(); process.exit(0); });

  await build();
  const watcher = watch(abspath, { persistent: true }, onChange);
  watcher.on('error', (e) => {
    if (spinner) spinner.fail(`watch error: ${e.message}`);
  });

  return new Promise(() => {});
}
