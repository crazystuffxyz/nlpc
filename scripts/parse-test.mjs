import { parseStructured } from '../lib/parser/structured.mjs';
const r = parseStructured('Make a function called total() that returns an int:\n    set sum = 0\n    for each x in {1,2,3,4,5}:\n        set sum = sum + x\n    return sum\n');
console.log(JSON.stringify(r, null, 2));
