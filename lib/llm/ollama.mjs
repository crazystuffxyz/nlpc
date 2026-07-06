// ollama wrapper - structured-output chat
import { Ollama } from 'ollama'; // ollama client
import { buildAjvSchema } from '../ir/schema.mjs'; // ir schema
import { validateIR } from '../ir/validator.mjs'; // validator
import { chunkProse } from '../parser/prose.mjs'; // prose chunker
import { allowlist } from '../deps/resolver.mjs'; // vcpkg allowlist

console.log('llm/ollama.mjs load'); // trace

export class LLM {
  constructor(cfg) { // ctor
    this.cfg = cfg; // cfg
    this.client = new Ollama({ host: cfg.ollamaHost }); // client
    console.log('LLM ctor host', cfg.ollamaHost, 'model', cfg.model); // trace
  }
  async ping() { // check
    try { const v = await this.client.list(); return { ok: true, models: v.models?.map(m => m.name) || [] }; } // ok
    catch (e) { return { ok: false, err: e.message }; } // fail
  }
  async extractIR(blocks, prose) { // blocks+prose -> IR
    console.log('extractIR blocks', blocks.length, 'prose', prose.length); // trace
    const system = SYSTEM_PROMPT_EXTRACT.replace('{{ALLOWLIST}}', JSON.stringify(allowlist())); // inject allowlist
    const user = buildExtractPrompt(blocks, prose); // build
    const schema = buildAjvSchema(); // ir schema
    const res = await this.callJSON(system, user, schema); // call
    return res; // return
  }
  async resolveUnknownDep(name) { // unknown -> vcpkg
    console.log('resolveUnknownDep', name); // trace
    const system = SYSTEM_PROMPT_DEP.replace('{{ALLOWLIST}}', JSON.stringify(allowlist())); // inject
    const user = `Map this requirement to a single vcpkg port name: ${JSON.stringify(name)}. Respond with JSON: {"vcpkg": "name-or-null", "confidence": 0-1}.`; // ask
    const res = await this.callJSON(system, user, { type: 'object', properties: { vcpkg: { type: 'string' }, confidence: { type: 'number' } }, required: ['vcpkg'] }); // call
    return res;
  }
  async regenerateCpp(ir, error) { // ir + error -> new cpp
    console.log('regenerateCpp', error.slice(0, 200)); // trace
    const system = SYSTEM_PROMPT_REPAIR; // system
    const user = REPAIR_USER_PROMPT(ir, error); // user
    const res = await this.client.generate({ model: this.cfg.model, system, prompt: user, stream: false, options: { temperature: 0.2 } }); // generate
    return res.response || ''; // text
  }
  async callJSON(system, user, formatSchema) { // generic json call
    console.log('callJSON model', this.cfg.model); // trace
    try {
      const res = await this.client.generate({ // generate
        model: this.cfg.model, // model
        system, // sys
        prompt: user, // user
        stream: false, // no stream
        format: formatSchema, // structured
        options: { temperature: 0.1 }, // low temp
      });
      const txt = res.response || ''; // text
      console.log('callJSON bytes', txt.length); // trace
      let json; // try
      try { json = JSON.parse(txt); } // parse
      catch (e) { // fail
        // try to extract first {...} block
        const m = txt.match(/\{[\s\S]*\}/); // match
        if (m) { try { json = JSON.parse(m[0]); } catch { throw new Error('llm returned invalid json: ' + txt.slice(0, 500)); } }
        else throw new Error('llm returned no json: ' + txt.slice(0, 500));
      }
      // validate against ir schema if it looks like an ir
      if (json.program) { // ir
        const v = validateIR(json); // validate
        if (!v.ok) throw new Error('llm ir invalid: ' + v.errors.map(e => e.path + ' ' + e.msg).join('; '));
      }
      return json; // return
    } catch (e) {
      console.error('callJSON err', e.message); // log
      throw e; // rethrow
    }
  }
}

const SYSTEM_PROMPT_EXTRACT = `You are a compiler front-end. Convert natural-language program descriptions into a strict JSON IR. Rules:
- Output ONLY valid JSON matching the schema. No prose, no markdown.
- "program.kind" is one of: console, rest, window, web, cli, library. Default to "console" if unclear.
- "requirements" must be an array of {name, source}. Use the vcpkg allowlist given below for "source":"vcpkg". If a library isn't in the allowlist, still include it - the resolver will handle it.
- "declarations" lists functions and variables. Functions have {kind:"function", name, params:[{name,type}], returns, body:[]}.
- "behaviors" lists what runs. Each has {trigger, body:[]} where trigger is one of: start, http_get, http_post, http_put, http_delete, route, loop, if.
- Allowed stmt kinds: print, ask, set, call, if, for, return, http_get, http_serve, http_route, route, json_load, json_save, file_read, file_write, log, sleep, assert, raw.
- "raw" stmt has {kind:"raw", code:"<c++ source>"}. Use this ONLY when no other stmt kind fits.
- Body arrays are empty for now; the code generator will fill them.
- Schema is enforced; the call will fail if you do not match it.

vcpkg allowlist (use these names verbatim for "source":"vcpkg"):
{{ALLOWLIST}}`;

const SYSTEM_PROMPT_DEP = `You are a C++ dependency resolver. Map a free-form library description to a single vcpkg port name. Use only ports from the allowlist. Output JSON: {"vcpkg":"<name-or-null>","confidence":<0..1>}. Null means you cannot map it. allowlist: {{ALLOWLIST}}`;

const SYSTEM_PROMPT_REPAIR = `You are a C++ code-generation repair assistant. You receive a JSON IR describing a program and a compiler error. Output ONLY the full corrected C++ source file. No markdown, no fences, no explanation. Match the IR exactly. The file must compile under C++20 with the libraries declared in the IR.`;

function REPAIR_USER_PROMPT(ir, err) { // user prompt for repair
  return `IR:
${JSON.stringify(ir, null, 2)}

Compiler error:
${err}

Regenerate the full corrected main.cpp:`;
}

function buildExtractPrompt(blocks, prose) { // user prompt
  const parts = []; // parts
  if (blocks.length) parts.push('STRUCTURED BLOCKS:\n' + JSON.stringify(blocks, null, 2)); // blocks
  if (prose.length) parts.push('FREE-FORM PROSE (interpret as program spec):\n' + chunkProse(prose).join('\n')); // prose
  return parts.join('\n\n') + '\n\nEmit the IR JSON now. No commentary.'; // done
}
