#!/usr/bin/env node
// nlpc cli entry - takes a .nlp file, lowers it to c++, compiles, optionally runs
import { program } from 'commander'; // cmd parsing
import chalk from 'chalk'; // colors
import ora from 'ora'; // spinners
import { run as compileRun } from '../lib/runner.mjs'; // main pipeline
import { doctor } from '../lib/doctor.mjs'; // env check
import { loadConfig } from '../lib/config.mjs'; // config loader
import { readFileSync } from 'node:fs'; // fs sync read
import { resolve } from 'node:path'; // path resolve
import { fileURLToPath } from 'node:url'; // url utils
import { dirname, join } from 'node:path'; // more path utils

console.log('nlpc cli boot'); // trace
const __dirname = dirname(fileURLToPath(import.meta.url)); // get our dir
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')); // load version
console.log('version', pkg.version); // trace

program // root cmd
  .name('nlpc')
  .description('natural-language programming language compiler')
  .version(pkg.version);

program // compile subcmd
  .command('compile')
  .argument('<file>', 'input .nlp file')
  .option('-o, --out <dir>', 'output directory', 'build-out')
  .option('--no-repair', 'disable the compile-error repair loop')
  .option('--no-run', 'compile only, do not run')
  .option('--model <name>', 'ollama model', 'codellama:7b-instruct')
  .option('--vcpkg-root <path>', 'path to vcpkg (else $VCPKG_ROOT)')
  .option('--keep-build', 'do not wipe build dir before compiling')
  .action(async (file, opts) => {
    console.log('compile cmd', file, opts); // trace
    const cfg = await loadConfig(opts); // load config
    const spinner = ora('compiling').start(); // spinner
    try {
      const res = await compileRun({ file: resolve(file), opts, cfg, spinner }); // run pipeline
      spinner.succeed(chalk.green(`built ${res.binary}`)); // success
      if (opts.run !== false) {
        console.log(chalk.cyan('\nrunning:')); // announce
        const { execFileSync } = await import('node:child_process'); // lazy import
        try { const out = execFileSync(res.binary, { stdio: 'inherit' }); console.log(String(out)); } // run
        catch (e) { console.error(chalk.red('run failed'), e.message); process.exit(1); } // fail loud
      }
    } catch (e) {
      spinner.fail(chalk.red('compile failed')); // fail spinner
      console.error(chalk.red(e.stack || e.message)); // err trace
      process.exit(1); // exit
    }
  });

program // doctor subcmd
  .command('doctor')
  .description('check toolchain, ollama, vcpkg')
  .action(async () => {
    console.log('doctor cmd'); // trace
    const cfg = await loadConfig({}); // load config
    const ok = await doctor(cfg); // check
    process.exit(ok ? 0 : 1); // exit code
  });

program // run subcmd
  .command('run')
  .argument('<file>', 'input .nlp file')
  .option('-o, --out <dir>', 'output directory', 'build-out')
  .option('--model <name>', 'ollama model', 'codellama:7b-instruct')
  .option('--vcpkg-root <path>', 'path to vcpkg (else $VCPKG_ROOT)')
  .action(async (file, opts) => {
    console.log('run cmd', file, opts); // trace
    const cfg = await loadConfig(opts); // config
    const spinner = ora('compile+run').start(); // spinner
    try {
      const res = await compileRun({ file: resolve(file), opts, cfg, spinner, runAfter: true }); // compile+run
      spinner.succeed(chalk.green('done')); // success
    } catch (e) {
      spinner.fail(chalk.red('failed')); // fail
      console.error(chalk.red(e.stack || e.message)); // err
      process.exit(1); // exit
    }
  });

program.parseAsync(process.argv).catch(e => { // parse
  console.error(chalk.red('cli error'), e); // err
  process.exit(1); // exit
});
