// ollama wrapper - structured-output chat
import { Ollama } from 'ollama';
import { buildAjvSchema } from '../ir/schema.mjs';
import { validateIR } from '../ir/validator.mjs';
import { chunkProse } from '../parser/prose.mjs';
import { allowlist } from '../deps/resolver.mjs';

export class LLM {
  constructor(cfg) {
    this.cfg = cfg;
    this.client = new Ollama({ host: cfg.ollamaHost });
  }
  async ping() {
    try { const v = await this.client.list(); return { ok: true, models: v.models?.map(m => m.name) || [] }; }
    catch (e) { return { ok: false, err: e.message }; }
  }
  async extractIR(blocks, prose) {
    const system = SYSTEM_PROMPT_EXTRACT.replace('{{ALLOWLIST}}', JSON.stringify(allowlist()));
    const user = buildExtractPrompt(blocks, prose);
    const schema = buildAjvSchema();
    const res = await this.callJSON(system, user, schema);
    return res;
  }
  async resolveUnknownDep(name) {
    const system = SYSTEM_PROMPT_DEP.replace('{{ALLOWLIST}}', JSON.stringify(allowlist()));
    const user = `Map this requirement to a single vcpkg port name: ${JSON.stringify(name)}. Respond with JSON: {"vcpkg": "name-or-null", "confidence": 0-1}.`;
    const res = await this.callJSON(system, user, { type: 'object', properties: { vcpkg: { type: 'string' }, confidence: { type: 'number' } }, required: ['vcpkg'] });
    return res;
  }
  async regenerateCpp(ir, error) {
    const system = SYSTEM_PROMPT_REPAIR;
    const user = REPAIR_USER_PROMPT(ir, error);
    const res = await this.client.generate({ model: this.cfg.model, system, prompt: user, stream: false, options: { temperature: 0.2 } });
    return res.response || '';
  }
  async callJSON(system, user, formatSchema) {
    try {
      const res = await this.client.generate({
        model: this.cfg.model,
        system,
        prompt: user,
        stream: false,
        format: formatSchema,
        options: { temperature: 0.1 },
      });
      const txt = res.response || '';
      let json;
      try { json = JSON.parse(txt); }
      catch (e) {
        // try to extract first {...} block
        const m = txt.match(/\{[\s\S]*\}/);
        if (m) { try { json = JSON.parse(m[0]); } catch { throw new Error('llm returned invalid json: ' + txt.slice(0, 500)); } }
        else throw new Error('llm returned no json: ' + txt.slice(0, 500));
      }
      // validate against ir schema if it looks like an ir
      if (json.program) {
        const v = validateIR(json);
        if (!v.ok) throw new Error('llm ir invalid: ' + v.errors.map(e => e.path + ' ' + e.msg).join('; '));
      }
      return json;
    } catch (e) {
      console.error('callJSON err', e.message);
      throw e;
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

const SYSTEM_PROMPT_DEP = `You are a C++ dependency resolver. Map a free-form library description to a single vcpkg port name from the allowlist below. Rules:
- The returned "vcpkg" field MUST be one of the port names in the allowlist, exactly. Do not invent a name.
- If none of the allowlist ports is a good match, return {"vcpkg": null, "confidence": 0}.
- Output JSON only, no prose. Schema: {"vcpkg":"<name-or-null>","confidence":<0..1>}.
allowlist: {{ALLOWLIST}}`;

const SYSTEM_PROMPT_REPAIR = `You are a C++ code-generation repair assistant. You receive a JSON IR describing a program and a compiler error. Output ONLY the full corrected C++ source file. No markdown, no fences, no explanation. Match the IR exactly. The file must compile under C++20 with the libraries declared in the IR.`;

function REPAIR_USER_PROMPT(ir, err) {
  return `IR:
${JSON.stringify(ir, null, 2)}

Compiler error:
${err}

Regenerate the full corrected main.cpp:`;
}

function buildExtractPrompt(blocks, prose) {
  const parts = [];
  if (blocks.length) parts.push('STRUCTURED BLOCKS:\n' + JSON.stringify(blocks, null, 2));
  if (prose.length) parts.push('FREE-FORM PROSE (interpret as program spec):\n' + chunkProse(prose).join('\n'));
  return parts.join('\n\n') + '\n\nEmit the IR JSON now. No commentary.';
}
