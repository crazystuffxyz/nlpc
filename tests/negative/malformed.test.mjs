// negative tests
import { test } from 'node:test'; // test
import assert from 'node:assert/strict'; // assert
import { parseStructured } from '../../lib/parser/structured.mjs'; // parser
import { buildIR } from '../../lib/ir/builder.mjs'; // builder
import { validateIR } from '../../lib/ir/validator.mjs'; // validator
import { emitCpp } from '../../lib/codegen/emit.mjs'; // codegen
import { run } from '../../lib/build/runner.mjs'; // build runner

console.log('negative tests load'); // trace

test('parser handles empty string', () => { // empty
  const r = parseStructured(''); // empty
  assert.equal(r.blocks.length, 0); // no blocks
  assert.equal(r.prose.length, 0); // no prose
});

test('buildIR throws on ir with no behaviors and no declarations', () => { // empty ir
  assert.throws(() => buildIR([], [], 'x'), /ir (invalid|empty)/); // throw
});

test('validateIR rejects non-object', () => { // bad
  const v = validateIR(null); // bad
  assert.equal(v.ok, false); // fail
});

test('build runner refuses non-allowlisted binary', async () => { // safety
  await assert.rejects(() => run('rm', ['-rf', '/']), /non-allowlisted/); // reject
});

test('emitCpp handles missing function body gracefully', () => { // missing body
  const ir = { // ir
    program: { name: 'x', kind: 'console' },
    requirements: [],
    declarations: [{ kind: 'function', name: 'fn', params: [], returns: 'void', body: [] }],
    behaviors: [{ trigger: 'start', body: [] }],
    constraints: [],
  };
  const cpp = emitCpp(ir); // emit
  assert.match(cpp, /void fn\(\)/); // fn
  assert.match(cpp, /int main/); // main
});

test('buildIR treats prose-only input as needing llm (offline throws)', () => { // prose
  // structured parser can't build IR from pure prose in offline mode
  // buildIR will produce an empty ir with no behaviors -> sanity check rejects
  assert.throws(() => buildIR([], ['this is just free text'], 'x'), /ir (invalid|empty)/); // throw
});
