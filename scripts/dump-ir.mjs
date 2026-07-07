import { parseStructured } from '../lib/parser/structured.mjs';
import { buildIR } from '../lib/ir/builder.mjs';
const file = process.argv[2];
const text = (await import('node:fs')).readFileSync(file, 'utf8');
const r = parseStructured(text);
try {
  const ir = buildIR(r.blocks, r.prose, 'f');
  console.log(JSON.stringify(ir, null, 2));
} catch (e) {
  console.log('parse err', e.message);
  console.log('blocks:', JSON.stringify(r.blocks, null, 2));
  console.log('prose:', JSON.stringify(r.prose, null, 2));
}
