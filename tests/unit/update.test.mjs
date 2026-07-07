// unit tests for the update checker. uses fetch's per-test stubbing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkForUpdate, cmp, currentVersion as current } from '../../lib/update.mjs';

test('cmp: same version returns 0', () => {
  assert.equal(cmp('0.1.0', '0.1.0'), 0);
  assert.equal(cmp('v1.2.3', '1.2.3'), 0);
});

test('cmp: newer > older', () => {
  assert.ok(cmp('0.2.0', '0.1.0') > 0);
  assert.ok(cmp('1.0.0', '0.9.9') > 0);
  assert.ok(cmp('0.1.1', '0.1.0') > 0);
});

test('cmp: older < newer', () => {
  assert.ok(cmp('0.1.0', '0.2.0') < 0);
});

test('cmp: handles missing patch/minor', () => {
  assert.ok(cmp('0.2', '0.1.9') > 0);
  assert.ok(cmp('1', '0.99.99') > 0);
});

test('currentVersion: returns a non-empty semver-ish string', () => {
  const v = current();
  assert.match(v, /^\d+\.\d+\.\d+/);
});

test('checkForUpdate: ok=false on http error (stubbed fetch)', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  try {
    const r = await checkForUpdate();
    assert.equal(r.ok, false);
    assert.match(r.reason, /500/);
  } finally {
    globalThis.fetch = orig;
  }
});

test('checkForUpdate: ok=true, upToDate=true when tag <= current', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ tag_name: 'v0.0.1', html_url: 'x', name: 'old' }),
  });
  try {
    const r = await checkForUpdate();
    assert.equal(r.ok, true);
    assert.equal(r.upToDate, true);
  } finally {
    globalThis.fetch = orig;
  }
});

test('checkForUpdate: ok=true, upToDate=false when tag > current', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ tag_name: 'v999.0.0', html_url: 'https://x', name: 'way newer' }),
  });
  try {
    const r = await checkForUpdate();
    assert.equal(r.ok, true);
    assert.equal(r.upToDate, false);
    assert.equal(r.latest, 'v999.0.0');
  } finally {
    globalThis.fetch = orig;
  }
});

test('checkForUpdate: ok=false on no tag', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({}),
  });
  try {
    const r = await checkForUpdate();
    assert.equal(r.ok, false);
    assert.match(r.reason, /no tag/);
  } finally {
    globalThis.fetch = orig;
  }
});
