// unit tests for the config loader
import { test } from 'node:test';
import assert from 'node:assert/strict';

// reset module cache between tests so loadConfig re-reads the env each time.
const fresh = async () => {
  const path = '../../lib/config.mjs?ts=' + Math.random();
  return import(path);
};

test('config: defaults applied when no opts/rc/env', async () => {
  // strip env vars that would override defaults.
  const oHost = process.env.OLLAMA_HOST; delete process.env.OLLAMA_HOST;
  const vRoot = process.env.VCPKG_ROOT; delete process.env.VCPKG_ROOT;
  const t = process.env.VCPKG_TARGET_TRIPLET; delete process.env.VCPKG_TARGET_TRIPLET;
  try {
    const { loadConfig } = await fresh();
    const c = await loadConfig({});
    assert.equal(c.ollamaHost, 'http://127.0.0.1:11434');
    assert.equal(c.cmake, 'cmake');
    assert.equal(c.repairMax, 5);
  } finally {
    if (oHost !== undefined) process.env.OLLAMA_HOST = oHost;
    if (vRoot !== undefined) process.env.VCPKG_ROOT = vRoot;
    if (t !== undefined) process.env.VCPKG_TARGET_TRIPLET = t;
  }
});

test('config: env var beats rc and opts (bug #22)', async () => {
  // bug: OLLAMA_HOST in DEFAULTS was read at module-load time, then
  // rc.ollamaHost overrode it, so the env var lost to a stale rc file.
  // the new loader reads env at call time and merges last so it wins.
  const oHost = process.env.OLLAMA_HOST; process.env.OLLAMA_HOST = 'http://env-host:1234';
  try {
    const { loadConfig } = await fresh();
    // rc passed in opts should still lose to env
    const c = await loadConfig({ ollamaHost: 'http://cli-host:5678' });
    assert.equal(c.ollamaHost, 'http://env-host:1234');
  } finally {
    if (oHost !== undefined) process.env.OLLAMA_HOST = oHost; else delete process.env.OLLAMA_HOST;
  }
});

test('config: cli opts beat rc when no env', async () => {
  const oHost = process.env.OLLAMA_HOST; delete process.env.OLLAMA_HOST;
  try {
    const { loadConfig } = await fresh();
    const c = await loadConfig({ ollamaHost: 'http://cli:1111' });
    assert.equal(c.ollamaHost, 'http://cli:1111');
  } finally {
    if (oHost !== undefined) process.env.OLLAMA_HOST = oHost;
  }
});
