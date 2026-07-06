#!/usr/bin/env node
// nlpc cli entry - takes a .nlp file, lowers it to c++, compiles, optionally runs
import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { run as compileRun } from '../lib/runner.mjs';
import { doctor } from '../lib/doctor.mjs';
import { loadConfig } from '../lib/config.mjs';
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
  .command('watch')
  .argument('<file>', 'input .nlp file')
  .option('-o, --out <dir>', 'output directory', 'build-out')
  .option('--no-repair', 'disable the compile-error repair loop')
  .option('--no-run', 'recompile only, do not run the binary')
  .option('--model <name>', 'ollama model (default: auto-pick from ollama list)')
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
