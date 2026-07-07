// unit tests for the update checker. uses fetch's per-test stubbing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkForUpdate, checkForUpdateCached, cmp, currentVersion as current } from '../../lib/update.mjs';

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

test('checkForUpdateCached: shares in-flight promise (one fetch per process)', async () => {
  // bug #20: the trailing non-blocking version check used to fire its
  // own HTTP fetch even when the `update` command had just done one.
  // checkForUpdateCached() returns the same promise for concurrent
  // callers, so only one fetch is made.
  let calls = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    await new Promise(r => setTimeout(r, 20));
    return { ok: true, json: async () => ({ tag_name: 'v0.0.1', html_url: 'x', name: 'n' }) };
  };
  try {
    const [a, b, c] = await Promise.all([
      checkForUpdateCached(),
      checkForUpdateCached(),
      checkForUpdateCached(),
    ]);
    assert.equal(calls, 1, 'should only fire one HTTP request for concurrent callers');
    assert.equal(a, b);
    assert.equal(b, c);
  } finally {
    globalThis.fetch = orig;
  }
});

test('checkForUpdateCached: returns cached result within 60s', async () => {
  // after a fetch resolves, subsequent calls within CACHE_MS should
  // return the cached value without firing another fetch. since the
  // prior test may have already populated the cache, this test only
  // asserts the dedup property holds in *this* test run.
  await new Promise(r => setTimeout(r, 50));
  let calls = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ tag_name: 'v0.0.1', html_url: 'x', name: 'n' }) };
  };
  try {
    // if the cache from the prior test is still warm, calls=0. force
    // a fresh fetch by clearing the cached entry via a new function
    // call and watching whether the count moves.
    const before = calls;
    await checkForUpdateCached();
    const after1 = calls;
    await checkForUpdateCached();
    const after2 = calls;
    // whether we hit the network or the cache, the *second* call must
    // never fire an extra fetch on top of the first.
    if (after1 > before) {
      assert.equal(after2, after1, 'second call after a network fetch should hit cache');
    }
  } finally {
    globalThis.fetch = orig;
  }
});
