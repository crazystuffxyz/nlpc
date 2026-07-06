# contributing

PRs welcome. before opening one:

## setup

```
git clone <repo>
cd Something
npm install
```

you need a local c++ toolchain to run the e2e test (g++/clang++,
cmake, vcpkg). without those, `npm run test:e2e` is skipped and the
other tests still pass.

## running tests

```
npm test                  # unit + integration + negative + security
npm run test:e2e          # real compile + run
npm run test:perf         # 200-line benchmark
```

all four should pass before you open a PR.

## style

- ESM (`import`/`export`), node 20+, no transpilation step
- no console.log in production code; `console.error` for real errors
- no external runtime deps beyond the ones in `package.json`
- prefer short, single-word variable names where the scope is local
- inline comments only where the *why* is non-obvious

## adding a dep to the curated map

edit `lib/deps/library-map.json` and add an entry:

```json
{ "keys": ["phrase", "alias", "another alias"], "vcpkg": "port-name" }
```

the resolver does a case-insensitive substring match, so include the
common phrasings users will reach for. prefer "natural language" keys
("graphics library", "compression") over technical names.

## adding a new stmt kind

1. add the kind to the `kind` enum in `lib/ir/schema.mjs` (in
   `buildAjvSchema`'s `stmtCore.properties.kind`)
2. add a case in `emitStmt` in `lib/codegen/emit.mjs`
3. if the LLM is expected to produce it, add a mention in
   `SYSTEM_PROMPT_EXTRACT` in `lib/llm/ollama.mjs`
4. add a unit test in `tests/unit/core.test.mjs`

## adding a new application kind

1. add to the `kind` enum in `lib/ir/schema.mjs` (`program.kind`)
2. add auto-injection logic in `lib/ir/builder.mjs` if the kind
   needs default deps
3. add the codegen branch in `lib/codegen/emit.mjs` (currently only
   `rest` has a dedicated branch)
