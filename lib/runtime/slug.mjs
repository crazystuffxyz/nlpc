// shared slug() - lowercased, identifier-safe, no path traversal.
// used by every place that takes a user/LLM-provided string and
// turns it into a directory or identifier name.
export function slug(s) {
  const out = String(s || 'app')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return out || 'app';
}

// identifier-safe - anything not matching this regex is rejected as a
// c++ identifier. used to validate unquoted identifier fields like
// function names, param names, call targets, iter names, etc.
const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function isIdent(s) {
  return typeof s === 'string' && ID_RE.test(s) && s.length > 0;
}

// c++ string literal - escapes a value the same way the emitter does
// for a string-stmt field. JSON.stringify covers \", \\, \b, \f, \n, \r, \t, \uXXXX.
export function cppString(v) {
  return JSON.stringify(String(v ?? ''));
}
