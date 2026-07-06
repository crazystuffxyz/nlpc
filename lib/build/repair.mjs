// repair loop - feeds compile errors back to the LLM
import { emitCpp } from '../codegen/emit.mjs'; // emitter
import { cmakeBuild } from './runner.mjs'; // build

console.log('build/repair.mjs load'); // trace

export async function repairLoop({ workdir, ir, llm, cfg, onAttempt }) { // main
  console.log('repairLoop max', cfg.repairMax); // trace
  let lastErr = null; // last err
  let cpp = null; // cpp
  for (let attempt = 1; attempt <= cfg.repairMax; attempt++) { // loop
    if (onAttempt) onAttempt(attempt); // cb
    try { // try build
      await cmakeBuild(workdir, cfg); // build
      return { ok: true, attempt, cpp }; // ok
    } catch (e) { // err
      lastErr = e; // save
      const errText = extractErrors(e); // text
      console.log(`repair attempt ${attempt} failed: ${errText.slice(0, 200)}`); // trace
      if (!llm) throw new Error('compile error and no llm for repair: ' + errText); // no llm
      // ask llm for new cpp
      const newCpp = await llm.regenerateCpp(ir, errText); // regen
      if (!newCpp || newCpp.length < 20) throw new Error('llm returned empty/short cpp on attempt ' + attempt); // empty
      cpp = newCpp; // save
      // overwrite main.cpp
      const { writeFileSync } = await import('node:fs'); // import
      writeFileSync(workdir + '/main.cpp', cpp, 'utf8'); // write
    }
  }
  throw new Error('repair loop exhausted (' + cfg.repairMax + ' attempts). last error: ' + extractErrors(lastErr)); // fail
}

function extractErrors(e) { // extract relevant lines from compiler stderr
  const text = (e.stderr || '') + '\n' + (e.stdout || ''); // both
  // take first 4000 chars, drop blank lines
  return text.split('\n').filter(l => l.trim()).slice(0, 80).join('\n').slice(0, 4000); // trim
}
