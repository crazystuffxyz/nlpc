// tests for the vcpkg-allowlist guard. the runtime must not pass any port
// name through to vcpkg.json unless (a) it was in library-map.json or
// (b) the LLM fallback returned a name from the same map. this protects
// against the "zstd linker error with no recovery" bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveRequirements, lookup, allowlist } from '../../lib/deps/resolver.mjs';

test('resolveRequirements: passes through mapped requirements', () => {
  const { packages, unknown } = resolveRequirements([
    { name: 'fmt', source: 'vcpkg' },
    { name: 'nlohmann-json', source: 'vcpkg' },
  ]);
  assert.ok(packages.includes('fmt'));
  assert.ok(packages.includes('nlohmann-json'));
  assert.equal(unknown.length, 0);
});

test('resolveRequirements: drops source:"unsupported" entries silently', () => {
  // the runner.mjs allowlist-guard marks any LLM-suggested port not in
  // the allowlist as source:"unsupported". the resolver must skip those.
  const { packages, unknown } = resolveRequirements([
    { name: 'fmt', source: 'vcpkg' },
    { name: 'made-up-port-name', source: 'unsupported' },
  ]);
  assert.ok(packages.includes('fmt'));
  assert.equal(packages.includes('made-up-port-name'), false);
  // unsupported entries are dropped, not pushed to unknown (which would
  // re-trigger the LLM fallback loop).
  assert.equal(unknown.length, 0);
});

test('resolveRequirements: unknown names go to the unknown list (so the runner can ask the LLM)', () => {
  const { packages, unknown } = resolveRequirements([
    { name: 'fmt', source: 'vcpkg' },
    { name: 'some-fictional-lib', source: 'vcpkg' },
  ]);
  assert.ok(packages.includes('fmt'));
  assert.equal(packages.includes('some-fictional-lib'), false);
  assert.deepEqual(unknown, ['some-fictional-lib']);
});

test('allowlist: returns the curated vcpkg port names (subset check)', () => {
  const a = allowlist();
  // must be a non-empty string array
  assert.ok(a.length > 0);
  assert.ok(a.every(s => typeof s === 'string'));
  // must include the most common ones
  for (const want of ['fmt', 'nlohmann-json', 'cpp-httplib', 'spdlog', 'gtest']) {
    assert.ok(a.includes(want), `allowlist missing ${want}`);
  }
});

test('lookup: finds by exact key', () => {
  assert.equal(lookup('fmt'), 'fmt');
  assert.equal(lookup('JSON parser library'), 'nlohmann-json');
  assert.equal(lookup('http client library'), 'cpp-httplib');
});

test('lookup: substring match for unlisted phrases', () => {
  // "make it use the json library" -> looks for any index key in the phrase
  assert.equal(lookup('a json library please'), 'nlohmann-json');
});

test('lookup: returns null for nonsense', () => {
  assert.equal(lookup('completely-fictional-thing-xyz'), null);
});

// mirrors the post-LLM loop in lib/runner.mjs: for each unknown dep, ask the
// LLM, and if it returns a name not in the allowlist, mark source:"unsupported".
// then resolve again. the fake port must end up dropped, never in the package
// list. this is the test that would have caught the "zstd linker error" bug.
test('runner-style allowlist guard: fake LLM port never reaches vcpkg.json', () => {
  const allowed = new Set(allowlist());
  const initialReqs = [
    { name: 'fmt', source: 'vcpkg' },
    { name: 'quantum thingamajig', source: 'vcpkg' }, // unknown -> ask LLM
  ];
  // round 1: separate mapped from unknown
  const r1 = resolveRequirements(initialReqs);
  assert.ok(r1.packages.includes('fmt'));
  assert.deepEqual(r1.unknown, ['quantum thingamajig']);

  // simulate the LLM returning a made-up port that's NOT in the allowlist
  const fakeLlmPort = 'made-up-sfml-clone';
  assert.equal(allowed.has(fakeLlmPort), false, 'test fixture broken: port is actually in allowlist');

  // round 2: apply the runner's guard, then resolve again
  const reqsAfterGuard = [...initialReqs];
  for (let i = 0; i < reqsAfterGuard.length; i++) {
    if (r1.unknown.includes(reqsAfterGuard[i].name)) {
      // the guard replaces the name only if the LLM returned an allowed port
      if (fakeLlmPort && allowed.has(fakeLlmPort)) {
        reqsAfterGuard[i] = { name: fakeLlmPort, source: 'vcpkg' };
      } else {
        reqsAfterGuard[i] = { name: reqsAfterGuard[i].name, source: 'unsupported' };
      }
    }
  }
  const r2 = resolveRequirements(reqsAfterGuard);
  assert.ok(r2.packages.includes('fmt'));
  assert.equal(r2.packages.includes(fakeLlmPort), false, 'fake port leaked into vcpkg.json');
  // unsupported entry is dropped, not re-queried
  assert.equal(r2.unknown.length, 0);
});
