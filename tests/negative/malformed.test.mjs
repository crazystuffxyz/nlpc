// negative tests
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStructured } from '../../lib/parser/structured.mjs';
import { buildIR } from '../../lib/ir/builder.mjs';
import { validateIR } from '../../lib/ir/validator.mjs';
import { emitCpp } from '../../lib/codegen/emit.mjs';
import { run } from '../../lib/build/runner.mjs';

test('parser handles empty string', () => {
  const r = parseStructured('');
  assert.equal(r.blocks.length, 0);
  assert.equal(r.prose.length, 0);
});

test('buildIR throws on ir with no behaviors and no declarations', () => {
  assert.throws(() => buildIR([], [], 'x'), /ir (invalid|empty)/);
});

test('validateIR rejects non-object', () => {
  const v = validateIR(null);
  assert.equal(v.ok, false);
});

test('build runner refuses non-allowlisted binary', async () => {
  await assert.rejects(() => run('rm', ['-rf', '/']), /non-allowlisted/);
});

test('emitCpp handles missing function body gracefully', () => {
  const ir = {
    program: { name: 'x', kind: 'console' },
    requirements: [],
    declarations: [{ kind: 'function', name: 'fn', params: [], returns: 'void', body: [] }],
    behaviors: [{ trigger: 'start', body: [] }],
    constraints: [],
  };
  const cpp = emitCpp(ir);
  assert.match(cpp, /void fn\(\)/);
  assert.match(cpp, /int main/);
});

test('buildIR treats prose-only input as needing llm (offline throws)', () => {
  // structured parser can't build IR from pure prose in offline mode
  // buildIR will produce an empty ir with no behaviors -> sanity check rejects
  assert.throws(() => buildIR([], ['this is just free text'], 'x'), /ir (invalid|empty)/);
});
