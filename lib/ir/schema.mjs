// ir v1 schema - strict json for the program. stmt is recursive and inlined
// here as a $defs entry so contributors editing this file (per CONTRIBUTING.md)
// land in the same place the validator reads from.

const STMT_PROPS = {
  kind: { enum: ['print', 'ask', 'set', 'call', 'if', 'for', 'return', 'http_get', 'http_post', 'http_put', 'http_patch', 'http_delete', 'http_serve', 'http_route', 'route', 'json_load', 'json_save', 'file_read', 'file_write', 'file_rename', 'file_delete', 'log', 'sleep', 'assert', 'raw'] },
  text: { type: 'string' },
  name: { type: 'string' },
  value: {},
  args: { type: 'array' },
  target: { type: 'string' },
  cond: { type: 'string' },
  body: { type: 'array', items: { $ref: '#/$defs/stmt' } },
  iter: { type: 'string' },
  // bug: `source` was typed as string, but the structured parser's
  // parseValue returns a number for `for each x in 5` (the value of
  // `5` is a number, not a string). the builder would emit a valid
  // c++ program but the validator would reject the IR. allow any
  // type to match what parseValue actually produces.
  source: {},
  path: { type: 'string' },
  // bug: file_rename uses from/to. file_delete reuses `path`.
  // both fields accept any value type because the structured
  // parser's parseValue may turn the source into a string, number,
  // or bare token depending on the syntax.
  from: {},
  fromIsString: { type: 'boolean' },
  to: {},
  toIsString: { type: 'boolean' },
  method: { type: 'string' },
  code: { type: 'string' },
  level: { enum: ['info', 'warn', 'error', 'debug'] },
  ms: { type: 'number' },
};

export const IR_V1 = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://nlpc.dev/schemas/ir-v1.json',
  type: 'object',
  additionalProperties: false,
  required: ['program'],
  properties: {
    program: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'kind'],
      properties: {
        // name is a slug, not a free path: ^[a-z0-9_]+$. the runner.mjs
        // sanitizes ir.program.name via slug() before it touches the fs.
        name: { type: 'string', pattern: '^[a-z0-9_]+$', minLength: 1 },
        kind: { enum: ['console', 'rest', 'window', 'web', 'cli', 'library'] },
        entry: { type: 'string' },
      },
    },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'source'],
        properties: {
          name: { type: 'string' },
          source: { enum: ['vcpkg', 'system', 'header', 'unsupported'] },
          features: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    declarations: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'name'],
            properties: {
              kind: { const: 'function' },
              name: { type: 'string' },
              params: { type: 'array', items: { $ref: '#/$defs/param' } },
              returns: { $ref: '#/$defs/type' },
              body: { type: 'array', items: { $ref: '#/$defs/stmt' } },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'name', 'value'],
            properties: {
              kind: { const: 'variable' },
              name: { type: 'string' },
              type: { $ref: '#/$defs/type' },
              value: {},
              // bug: the builder tags the rhs with isString so the
              // emitter can pick a matching c++ type. without this
              // field the validator (additionalProperties:false on
              // the declaration shape) rejected the IR.
              isString: { type: 'boolean' },
            },
          },
        ],
      },
    },
    behaviors: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['trigger', 'body'],
        properties: {
          trigger: { enum: ['start', 'http_get', 'http_post', 'http_put', 'http_patch', 'http_delete', 'route', 'loop', 'if'] },
          path: { type: 'string' },
          method: { type: 'string' },
          body: { type: 'array', items: { $ref: '#/$defs/stmt' } },
        },
      },
    },
    constraints: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: { enum: ['cxx_standard', 'no_exceptions', 'no_rtti', 'static', 'sanitizer'] },
          value: {},
        },
      },
    },
  },
  $defs: {
    type: {
      type: 'string',
      enum: ['string', 'int', 'double', 'bool', 'void', 'auto', 'json', 'bytes', 'vector<string>', 'vector<int>', 'http_response', 'file'],
    },
    param: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'type'],
      properties: {
        name: { type: 'string' },
        type: { $ref: '#/$defs/type' },
      },
    },
    stmt: {
      type: 'object',
      required: ['kind'],
      additionalProperties: true,
      properties: STMT_PROPS,
    },
  },
};

// buildAjvSchema returns IR_V1 directly. kept as a function for API
// compatibility (validator.mjs and tests call buildAjvSchema()).
export function buildAjvSchema() {
  return JSON.parse(JSON.stringify(IR_V1));
}
