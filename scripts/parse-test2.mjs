import { parseStructured } from '../lib/parser/structured.mjs';
import { buildIR } from '../lib/ir/builder.mjs';
const r = parseStructured('Create a console application.\nMake a function called total() that returns an int:\n    set sum = 0\n    for each x in {1,2,3,4,5}:\n        set sum = sum + x\n    return sum\n');
const ir = buildIR(r.blocks, r.prose, 'f');
console.log(JSON.stringify(ir.declarations, null, 2));
