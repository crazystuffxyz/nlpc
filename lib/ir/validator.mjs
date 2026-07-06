// ir validator - ajv wrapper
import Ajv from 'ajv'; // ajv
import addFormats from 'ajv-formats'; // formats
import { buildAjvSchema } from './schema.mjs'; // schema

console.log('ir/validator.mjs load'); // trace

const ajv = new Ajv({ allErrors: true, strict: false }); // ajv
addFormats(ajv); // formats
const validate = ajv.compile(buildAjvSchema()); // compile
console.log('ir validator compiled'); // trace

export function validateIR(ir) { // main
  console.log('validateIR'); // trace
  const ok = validate(ir); // check
  if (ok) return { ok: true, errors: [] }; // ok
  return { ok: false, errors: (validate.errors || []).map(e => ({ path: e.instancePath, msg: e.message, params: e.params })) };
}
