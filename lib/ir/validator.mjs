// ir validator - ajv wrapper
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildAjvSchema } from './schema.mjs';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(buildAjvSchema());

export function validateIR(ir) {
  const ok = validate(ir);
  if (ok) return { ok: true, errors: [] };
  return { ok: false, errors: (validate.errors || []).map(e => ({ path: e.instancePath, msg: e.message, params: e.params })) };
}
