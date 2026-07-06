// ir v1 schema - strict json for the program

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
        name: { type: 'string', minLength: 1 },
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
          source: { enum: ['vcpkg', 'system', 'header'] },
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
              params: { type: 'array', items: { $ref: '#/definitions/param' } },
              returns: { $ref: '#/definitions/type' },
              body: { type: 'array', items: { $ref: '#/definitions/stmt' } },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'name', 'value'],
            properties: {
              kind: { const: 'variable' },
              name: { type: 'string' },
              type: { $ref: '#/definitions/type' },
              value: {},
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
          trigger: { enum: ['start', 'http_get', 'http_post', 'http_put', 'http_delete', 'route', 'loop', 'if'] },
          path: { type: 'string' },
          method: { type: 'string' },
          body: { type: 'array', items: { $ref: '#/definitions/stmt' } },
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
  definitions: {
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
        type: { $ref: '#/definitions/type' },
      },
    },
    stmt: {
      // recursive; ajv handles it via $ref
      type: 'object',
    },
  },
};

// stmt is recursive - we expand it via a helper at runtime so ajv can resolve $refs
export function buildAjvSchema() {
  const stmtCore = {
    $id: 'stmtCore',
    type: 'object',
    additionalProperties: true,
    required: ['kind'],
    properties: {
      kind: { enum: ['print', 'ask', 'set', 'call', 'if', 'for', 'return', 'http_get', 'http_serve', 'http_route', 'route', 'json_load', 'json_save', 'file_read', 'file_write', 'log', 'sleep', 'assert', 'raw'] },
      text: { type: 'string' },
      name: { type: 'string' },
      value: {},
      args: { type: 'array' },
      target: { type: 'string' },
      cond: { type: 'string' },
      body: { type: 'array', items: { $ref: 'stmt' } },
      iter: { type: 'string' },
      source: { type: 'string' },
      path: { type: 'string' },
      method: { type: 'string' },
      code: { type: 'string' },
      level: { enum: ['info', 'warn', 'error', 'debug'] },
    },
  };
  const stmt = { $id: 'stmt', $ref: 'stmtCore' };
  const deep = JSON.parse(JSON.stringify(IR_V1));
  deep.definitions.stmtCore = stmtCore;
  deep.definitions.stmt = stmt;
  return deep;
}
