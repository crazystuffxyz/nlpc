// ir sanitization - strip stmt kinds that are unsafe to accept from
// untrusted input (LLM output, prose interpretation). the structured
// DSL never produces these, so stripping them only affects LLM paths.

// stripRawStmts removes every { kind: 'raw', ... } stmt from the IR.
// returns the number of stmts removed. walks behaviors (and any
// nested stmt.body arrays) and declaration bodies recursively.
export function stripRawStmts(ir) {
  if (!ir) return 0;
  let stripped = 0;
  const visit = (body) => {
    if (!Array.isArray(body)) return;
    for (let i = body.length - 1; i >= 0; i--) {
      const s = body[i];
      if (s && s.kind === 'raw') { body.splice(i, 1); stripped++; }
      else if (s && Array.isArray(s.body)) visit(s.body);
    }
  };
  visit(ir.behaviors);
  for (const d of (ir.declarations || [])) {
    if (d && Array.isArray(d.body)) visit(d.body);
  }
  return stripped;
}
