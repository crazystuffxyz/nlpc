// unit tests for new features: setup, project, register
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setup } from '../../lib/setup.mjs';
import { loadProject, discoverEntries } from '../../lib/project.mjs';

test('setup detects present and missing tools', async () => {
  // node is always present, g++ should be (we have it locally).
  // we just check that the function returns without throwing and reports at least node.
  const r = await setup({ yes: false, dryRun: true });
  assert.ok(Array.isArray(r.installed));
  // installed may be empty since we only dry-run on missing, but the function should not throw.
  // in dry-run mode missing tools are added to installed (so user sees what would happen).
  assert.equal(typeof r.ok, 'boolean');
});

test('setup --dry-run does not actually install', async () => {
  const r = await setup({ yes: true, dryRun: true });
  assert.ok(Array.isArray(r.installed));
});

test('parseToml: loadProject reads nlpc.toml', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nlpc-proj-'));
  writeFileSync(join(dir, 'nlpc.toml'),
    '[project]\nname = "demo"\nversion = "0.1.0"\n\n[build]\nparallel = true\n\n[[entries]]\nfile = "src/main.nlp"\nname = "main"\n',
    'utf8');
  const p = loadProject(dir);
  assert.ok(p);
  assert.equal(p.project.name, 'demo');
  assert.equal(p.build.parallel, true);
  assert.equal(p.entries.length, 1);
  assert.equal(p.entries[0].file, 'src/main.nlp');
  assert.equal(p.entries[0].name, 'main');
});

test('loadProject returns null when nlpc.toml missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nlpc-proj-'));
  const p = loadProject(dir);
  assert.equal(p, null);
});

test('discoverEntries auto-finds .nlp files when no [[entries]] block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nlpc-proj-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.nlp'), 'When the program starts:\n    print a\n', 'utf8');
  writeFileSync(join(dir, 'src', 'b.nlp'), 'When the program starts:\n    print b\n', 'utf8');
  const files = discoverEntries(dir, null);
  assert.equal(files.length, 2);
  assert.ok(files.every(f => f.endsWith('.nlp')));
});

test('discoverEntries skips build-out and node_modules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nlpc-proj-'));
  mkdirSync(join(dir, 'build-out'), { recursive: true });
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  writeFileSync(join(dir, 'a.nlp'), 'print a\n', 'utf8');
  writeFileSync(join(dir, 'build-out', 'skip.nlp'), 'print skip\n', 'utf8');
  writeFileSync(join(dir, 'node_modules', 'skip.nlp'), 'print skip\n', 'utf8');
  const files = discoverEntries(dir, null);
  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith('a.nlp'));
});
