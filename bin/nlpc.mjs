#!/usr/bin/env node
// nlpc cli entry - takes a .nlp file, lowers it to c++, compiles, optionally runs
import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { run as compileRun } from '../lib/runner.mjs';
import { doctor } from '../lib/doctor.mjs';
import { loadConfig } from '../lib/config.mjs';
import { setup } from '../lib/setup.mjs';
import { buildProject, loadProject } from '../lib/project.mjs';
import { register } from '../lib/register.mjs';
import { checkForUpdate } from '../lib/update.mjs';
import { spawn as spawnChild } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

program
  .name('nlpc')
  .description('natural-language programming language compiler')
  .version(pkg.version);

program
  .command('compile')
  .argument('<file>', 'input .nlp file')
  .option('-o, --out <dir>', 'output directory', 'build-out')
  .option('--no-repair', 'disable the compile-error repair loop')
  .option('--no-run', 'compile only, do not run')
  .option('--model <name>', 'ollama model (default: auto-pick from ollama list)')
  .option('--ollama-host <url>', 'ollama server (default: $OLLAMA_HOST or http://127.0.0.1:11434)')
  .option('--vcpkg-root <path>', 'path to vcpkg (else $VCPKG_ROOT)')
  .option('--keep-build', 'do not wipe build dir before compiling')
  .action(async (file, opts) => {
    const cfg = await loadConfig(opts);
    const spinner = ora('compiling').start();
    try {
      const res = await compileRun({ file: resolve(file), opts, cfg, spinner });
      spinner.succeed(chalk.green(`built ${res.binary}`));
      if (opts.run !== false) {
        console.log(chalk.cyan('\nrunning:'));
        const { execFileSync } = await import('node:child_process');
        try {
          const out = execFileSync(res.binary, { stdio: 'inherit' });
          console.log(String(out));
        } catch (e) {
          console.error(chalk.red('run failed'), e.message);
          process.exit(1);
        }
      }
    } catch (e) {
      spinner.fail(chalk.red('compile failed'));
      console.error(chalk.red(e.stack || e.message));
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('check toolchain, ollama, vcpkg')
  .action(async () => {
    const cfg = await loadConfig({});
    const ok = await doctor(cfg);
    process.exit(ok ? 0 : 1);
  });

program
  .command('run')
  .argument('<file>', 'input .nlp file')
  .option('-o, --out <dir>', 'output directory', 'build-out')
  .option('--model <name>', 'ollama model (default: auto-pick from ollama list)')
  .option('--ollama-host <url>', 'ollama server (default: $OLLAMA_HOST or http://127.0.0.1:11434)')
  .option('--vcpkg-root <path>', 'path to vcpkg (else $VCPKG_ROOT)')
  .action(async (file, opts) => {
    const cfg = await loadConfig(opts);
    const spinner = ora('compile+run').start();
    try {
      const res = await compileRun({ file: resolve(file), opts, cfg, spinner, runAfter: true });
      spinner.succeed(chalk.green('done'));
    } catch (e) {
      spinner.fail(chalk.red('failed'));
      console.error(chalk.red(e.stack || e.message));
      process.exit(1);
    }
  });

program
  .command('build')
  .argument('[path]', 'project dir or .nlp file', '.')
  .option('-o, --out <dir>', 'output directory', 'build-out')
  .option('--no-repair', 'disable the compile-error repair loop')
  .option('--no-run', 'compile only, do not run')
  .option('--model <name>', 'ollama model (default: auto-pick from ollama list)')
  .option('--ollama-host <url>', 'ollama server (default: $OLLAMA_HOST or http://127.0.0.1:11434)')
  .option('--vcpkg-root <path>', 'path to vcpkg (else $VCPKG_ROOT)')
  .action(async (pathArg, opts) => {
    const cfg = await loadConfig(opts);
    const abs = resolve(pathArg);
    const isFile = abs.endsWith('.nlp');
    const spinner = ora(isFile ? 'compiling' : 'building project').start();
    try {
      if (isFile) {
        const res = await compileRun({ file: abs, opts, cfg, spinner });
        spinner.succeed(chalk.green(`built ${res.binary}`));
      } else {
        const res = await buildProject({ dir: abs, opts, cfg, spinner });
        spinner.succeed(chalk.green(`built ${res.entries.length} entries -> ${res.outDir}`));
      }
    } catch (e) {
      spinner.fail(chalk.red('build failed'));
      console.error(chalk.red(e.stack || e.message));
      process.exit(1);
    }
  });

program
  .command('setup')
  .description('detect and install missing toolchain (g++, cmake, vcpkg, ollama)')
  .option('--yes', 'non-interactive: install without asking')
  .option('--dry-run', 'print what would be installed, do not run')
  .action(async (opts) => {
    const r = await setup({ yes: !!opts.yes, dryRun: !!opts.dryRun });
    process.exit(r.ok ? 0 : 1);
  });

program
  .command('register')
  .description('register .nlp files with the OS so double-click runs nlpc compile')
  .action(async () => {
    const r = await register();
    if (r.ok) console.log(chalk.green('registered'));
  });

program
  .command('add-to-path')
  .description('add the nlpc bin dir to the user PATH (no truncation)')
  .option('--target <dir>', 'where to put the binary', '')
  .option('--yes', 'skip confirmation')
  .action(async (o) => {
    const args = ['scripts/install.mjs', 'add-to-path', ...(o.target ? ['--target', o.target] : []), ...(o.yes ? ['--yes'] : [])];
    const child = spawnChild(process.execPath, args, { stdio: 'inherit' });
    child.on('exit', c => process.exit(c || 0));
  });

program
  .command('update')
  .description('check for a newer nlpc release')
  .action(async () => {
    const r = await checkForUpdate();
    if (!r.ok) { console.log('could not check:', r.reason); process.exit(1); }
    if (r.upToDate) { console.log(`up to date (${r.current})`); return; }
    console.log(`update available: ${r.current} -> ${r.latest}`);
    console.log(`run: npm install -g crazystuffxyz/nlpc`);
    console.log(`or:  ${r.url}`);
  });

program
  .command('watch')
  .argument('<file>', 'input .nlp file')
  .option('-o, --out <dir>', 'output directory', 'build-out')
  .option('--no-repair', 'disable the compile-error repair loop')
  .option('--no-run', 'recompile only, do not run the binary')
  .option('--model <name>', 'ollama model (default: auto-pick from ollama list)')
  .option('--ollama-host <url>', 'ollama server (default: $OLLAMA_HOST or http://127.0.0.1:11434)')
  .option('--vcpkg-root <path>', 'path to vcpkg (else $VCPKG_ROOT)')
  .action(async (file, opts) => {
    const cfg = await loadConfig(opts);
    const spinner = ora('watching').start();
    const { watchFile } = await import('../lib/watch.mjs');
    await watchFile({ file: resolve(file), opts, cfg, spinner });
  });

program.parseAsync(process.argv).catch(e => {
  console.error(chalk.red('cli error'), e);
  process.exit(1);
});

// non-blocking version check. skip when the user is running `nlpc update`
// itself (that handler does its own check), or for trivial info subcommands
// where the trailing message would just be noise. failures are silent
// (don't pollute output for offline users).
const updateCheckCmds = new Set(['compile', 'run', 'build', 'watch']);
const invoked = process.argv.slice(2).find(a => !a.startsWith('-'));
if (invoked && updateCheckCmds.has(invoked)) {
  checkForUpdate().then(r => {
    if (r?.ok && !r.upToDate) {
      console.error(chalk.yellow(`\nnlpc ${r.latest} available (you have ${r.current}). run: npm install -g crazystuffxyz/nlpc`));
    }
  }).catch(() => {});
}
