// performance bench - measure parse+IR+codegen on a generated 200-line .nlp
import { performance } from 'node:perf_hooks';
import { parseStructured } from '../../lib/parser/structured.mjs';
import { buildIR } from '../../lib/ir/builder.mjs';
import { emitCpp } from '../../lib/codegen/emit.mjs';
import { emitProject } from '../../lib/codegen/cmake.mjs';

function genNLP(n) {
  const lines = ['Create a console application.', ''];
  for (let i = 0; i < n; i++) {
    if (i % 7 === 0) lines.push(`Require the fmt library.`);
    else if (i % 11 === 0) lines.push(`Make a function called fn${i} that takes a number and returns an int.`);
    else if (i % 5 === 0) lines.push(`print line ${i}`);
    else if (i % 13 === 0) lines.push(`ask the user for value ${i}`);
    else lines.push(`call helper${i}`);
  }
  return lines.join('\n');
}

async function bench() {
  const big = genNLP(200);
  console.log(`input bytes ${big.length}`);
  const t = performance.now();
  const { blocks, prose } = parseStructured(big);
  const ir = buildIR(blocks, prose, 'bench');
  const cpp = emitCpp(ir);
  const proj = emitProject(ir, 'bench');
  const dt = performance.now() - t;
  console.log(`parse+IR+codegen 200-line .nlp: ${dt.toFixed(1)}ms (${cpp.length} bytes cpp)`);
  if (dt > 2000) { console.error('PERF FAIL: exceeded 2000ms budget'); process.exit(1); }
  console.log('perf ok');
}

bench().catch(e => { console.error('bench err', e); process.exit(1); });
