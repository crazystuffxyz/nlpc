// performance bench - measure parse+IR+codegen on a generated 200-line .nlp
import { performance } from 'node:perf_hooks'; // perf
import { parseStructured } from '../../lib/parser/structured.mjs'; // parser
import { buildIR } from '../../lib/ir/builder.mjs'; // builder
import { emitCpp, setReqFmt } from '../../lib/codegen/emit.mjs'; // emit
import { emitProject } from '../../lib/codegen/cmake.mjs'; // cmake

console.log('perf bench load'); // trace

function genNLP(n) { // generate a big .nlp
  const lines = ['Create a console application.', '']; // hdr
  for (let i = 0; i < n; i++) { // loop
    if (i % 7 === 0) lines.push(`Require the fmt library.`); // req
    else if (i % 11 === 0) lines.push(`Make a function called fn${i} that takes a number and returns an int.`); // fn
    else if (i % 5 === 0) lines.push(`print line ${i}`); // print
    else if (i % 13 === 0) lines.push(`ask the user for value ${i}`); // ask
    else lines.push(`call helper${i}`); // call
  }
  return lines.join('\n');
}

async function bench() { // bench
  const big = genNLP(200); // 200 lines
  console.log(`input bytes ${big.length}`); // log
  const t = performance.now(); // start
  const { blocks, prose } = parseStructured(big); // parse
  const ir = buildIR(blocks, prose, 'bench'); // build
  setReqFmt(true); // fmt
  const cpp = emitCpp(ir); // emit
  const proj = emitProject(ir, 'bench'); // cmake
  const dt = performance.now() - t; // delta
  console.log(`parse+IR+codegen 200-line .nlp: ${dt.toFixed(1)}ms (${cpp.length} bytes cpp)`); // log
  if (dt > 2000) { console.error('PERF FAIL: exceeded 2000ms budget'); process.exit(1); } // fail
  console.log('perf ok'); // ok
}

bench().catch(e => { console.error('bench err', e); process.exit(1); });
