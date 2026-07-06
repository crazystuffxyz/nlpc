// repair loop - feeds compile errors back to the LLM
import { emitCpp } from '../codegen/emit.mjs';
import { cmakeBuild } from './runner.mjs';

export async function repairLoop({ workdir, ir, llm, cfg, onAttempt }) {
  let lastErr = null;
  let cpp = null;
  for (let attempt = 1; attempt <= cfg.repairMax; attempt++) {
    if (onAttempt) onAttempt(attempt);
    try {
      await cmakeBuild(workdir, cfg);
      return { ok: true, attempt, cpp };
    } catch (e) {
      lastErr = e;
      const errText = extractErrors(e);
      if (!llm) throw new Error('compile error and no llm for repair: ' + errText);
      // ask llm for new cpp
      const newCpp = await llm.regenerateCpp(ir, errText);
      if (!newCpp || newCpp.length < 20) throw new Error('llm returned empty/short cpp on attempt ' + attempt);
      cpp = newCpp;
      // overwrite main.cpp
      const { writeFileSync } = await import('node:fs');
      writeFileSync(workdir + '/main.cpp', cpp, 'utf8');
    }
  }
  throw new Error('repair loop exhausted (' + cfg.repairMax + ' attempts). last error: ' + extractErrors(lastErr));
}

function extractErrors(e) {
  const text = (e.stderr || '') + '\n' + (e.stdout || '');
  // take first 4000 chars, drop blank lines
  return text.split('\n').filter(l => l.trim()).slice(0, 80).join('\n').slice(0, 4000);
}
