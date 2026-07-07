// c++ reserved words that we must not emit as identifiers. the user can
// write `Make a function called int` or `set class = 5` and the IR
// builder would happily pass `int` / `class` through. c++ then refuses
// to compile `int int() { ... }` or `auto class = 5;`. renaming them
// with a trailing underscore is a tiny fix that keeps the rest of the
// pipeline happy without rejecting reasonable input.
const CXX_RESERVED = new Set([
  'alignas','alignof','auto','bool','break','case','catch','char','class','const','constexpr','continue',
  'decltype','default','delete','do','double','dynamic_cast','else','enum','explicit','export','extern',
  'false','float','for','friend','goto','if','inline','int','long','mutable','namespace','new','noexcept',
  'nullptr','operator','private','protected','public','register','reinterpret_cast','return','short',
  'signed','sizeof','static','static_assert','static_cast','struct','switch','template','this','thread_local',
  'throw','true','try','typedef','typeid','typename','union','unsigned','using','virtual','void','volatile',
  'wchar_t','while','and','or','not','xor',
]);

// shared slug() - lowercased, identifier-safe, no path traversal, no c++
// reserved words. used by every place that takes a user/LLM-provided
// string and turns it into a directory or identifier name.
export function slug(s) {
  let out = String(s || 'app')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  if (!out) out = 'app';
  if (CXX_RESERVED.has(out)) out = out + '_n';
  return out;
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
