// prose - groups free-form text into chunks to feed the LLM
console.log('parser/prose.mjs load'); // trace

export function chunkProse(lines) { // chunk
  console.log('chunkProse', lines.length); // trace
  const chunks = []; // collect
  let buf = []; // buffer
  const flush = () => { if (buf.length) { chunks.push(buf.join(' ').trim()); buf = []; } }; // flush
  for (const l of lines) { // loop
    if (l === '' || /^\s*$/.test(l)) { flush(); continue; } // blank separator
    buf.push(l); // push
    if (buf.join(' ').length > 400) flush(); // chunk size
  }
  flush(); // last
  return chunks;
}
