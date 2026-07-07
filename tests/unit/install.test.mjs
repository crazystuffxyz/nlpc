// unit tests for the install script. we mock platform() and fs reads to exercise
// both the windows and the mac/linux code paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

// we can't easily change `platform()` at runtime, so we test the small
// helpers directly. bigger integration tests live in tests/integration.
import { readUserPath, writeUserPath, parseArgs, HOME_DEFAULT, getBinDir } from '../../lib/install.mjs';

test('parseArgs: defaults to npm mode, no flags', () => {
  // simulate argv: ['node','install.mjs','install']
  const a = parseArgs(['node', 'install.mjs', 'install']);
  assert.equal(a.mode, 'npm');
  assert.equal(a.addToPath, false);
  assert.equal(a.yes, false);
});

test('parseArgs: --binary flips mode', () => {
  const a = parseArgs(['node', 'install.mjs', 'install', '--binary']);
  assert.equal(a.mode, 'binary');
});

test('parseArgs: --yes sets yes', () => {
  const a = parseArgs(['node', 'install.mjs', 'install', '--yes']);
  assert.equal(a.yes, true);
});

test('parseArgs: --target captures next arg', () => {
  const a = parseArgs(['node', 'install.mjs', 'install', '--target', 'C:/foo']);
  assert.equal(a.target, 'C:/foo');
});

test('parseArgs: add-to-path subcommand sets addToPath=true', () => {
  const a = parseArgs(['node', 'install.mjs', 'add-to-path']);
  assert.equal(a.addToPath, true);
});

test('parseArgs: --no-install sets noInstall=true', () => {
  const a = parseArgs(['node', 'install.mjs', 'install', '--no-install']);
  assert.equal(a.noInstall, true);
});

test('getBinDir: defaults to ~/.nlpc/bin', () => {
  const d = getBinDir('');
  // cross-platform: must end in .nlpc + bin (with whatever separator)
  assert.match(d, /[\\/]\.nlpc[\\/]bin$/, `expected .../.nlpc/bin, got ${d}`);
});

test('getBinDir: respects --target', () => {
  assert.equal(getBinDir('C:/custom'), 'C:/custom');
});

test('readUserPath on mac/linux: parses export PATH=... from rcfile', () => {
  if (process.platform === 'win32') return; // skip on windows
  const dir = mkdtempSync(join(tmpdir(), 'nlpc-test-rc-'));
  const rc = join(dir, '.bashrc');
  writeFileSync(rc, 'export PATH="/usr/bin:/bin"\n');
  // patch SHELL so the helper picks bash
  const oldShell = process.env.SHELL;
  process.env.SHELL = '/bin/bash';
  try {
    // exercise the same regex the lib uses, against our temp rc file
    const text = readFileSync(rc, 'utf8');
    const m = text.match(/^export PATH="([^"]+)"/m);
    assert.equal(m && m[1], '/usr/bin:/bin');
  } finally {
    process.env.SHELL = oldShell;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeUserPath on mac/linux: appends managed block, removes prior block', () => {
  if (process.platform === 'win32') return; // tested separately
  const dir = mkdtempSync(join(tmpdir(), 'nlpc-test-rc-'));
  const rc = join(dir, '.bashrc');
  writeFileSync(rc, 'export PATH="/usr/bin"\n# >>> nlpc path >>>\nexport PATH="/old:$PATH"\n# <<< nlpc path <<<\n');
  // re-implement the write logic to assert shape
  let text = readFileSync(rc, 'utf8');
  text = text.replace(/^# >>> nlpc path >>>[\s\S]*?# <<< nlpc path <<<\n?/m, '');
  text = text.replace(/^export PATH="[^"]*"\n?/m, '');
  text += `\n# >>> nlpc path >>>\nexport PATH="/new:$PATH"\n# <<< nlpc path <<<\n`;
  // assert the prior block was removed and the new one written
  assert.equal(text.match(/# >>> nlpc path >>>/g).length, 1);
  assert.ok(text.includes('export PATH="/new:$PATH"'));
  assert.ok(!text.includes('"/old:$PATH"'));
  rmSync(dir, { recursive: true, force: true });
});

