// prose - groups free-form text into chunks to feed the LLM

export function chunkProse(lines) {
  const chunks = [];
  let buf = [];
  const flush = () => { if (buf.length) { chunks.push(buf.join(' ').trim()); buf = []; } };
  for (const l of lines) {
    if (l === '' || /^\s*$/.test(l)) { flush(); continue; }
    buf.push(l);
    if (buf.join(' ').length > 400) flush();
  }
  flush();
  return chunks;
}
