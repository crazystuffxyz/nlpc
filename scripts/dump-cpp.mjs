// dump the generated cpp for an .nlp file (no build).
import { parseStructured } from '../lib/parser/structured.mjs';
import { buildIR } from '../lib/ir/builder.mjs';
import { emitCpp } from '../lib/codegen/emit.mjs';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const text = readFileSync(file, 'utf8');
const { blocks, prose } = parseStructured(text);
const ir = buildIR(blocks, prose, file.split(/[\/]/).pop().replace(/\.nlp$/, ''));
console.log(emitCpp(ir));
