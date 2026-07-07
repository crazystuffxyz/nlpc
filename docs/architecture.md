# architecture

how the pieces fit together.

## pipeline

```
.nlp file
   |
   v
parseStructured
   |  (lib/parser/structured.mjs)
   |  regex-based DSL parser, returns { blocks, prose }
   v
buildIR
   |  (lib/ir/builder.mjs)
   |  blocks -> IR JSON, validates with ajv
   v
   +-- if blocks are empty, prompt ollama (lib/llm/ollama.mjs)
   |   to convert prose into IR
   v
resolveRequirements
   |  (lib/deps/resolver.mjs)
   |  phrase -> vcpkg port, falls back to LLM with allowlist
   v
emitCpp
   |  (lib/codegen/emit.mjs)
   |  IR -> main.cpp
   v
emitProject
   |  (lib/codegen/cmake.mjs)
   |  IR -> CMakeLists.txt + vcpkg.json
   v
vcpkg install
   |  (lib/build/runner.mjs)
   |  in manifest mode, populates vcpkg_installed/
   v
cmake configure + build
   |
   v
   +-- on failure: repairLoop
   |   (lib/build/repair.mjs)
   |   sends IR + compiler stderr to ollama,
   |   overwrites main.cpp with response, retries (max 5)
   v
executable
```

## components

| module | purpose |
|--------|---------|
| `bin/nlpc.mjs` | CLI entry. `compile`, `run`, `doctor` subcommands. |
| `lib/runner.mjs` | orchestrator. wires all the pieces together. |
| `lib/config.mjs` | merges defaults, env vars, .nlpcrc.json, CLI opts. |
| `lib/doctor.mjs` | toolchain health check. |
| `lib/parser/structured.mjs` | regex DSL parser. ordered patterns, first match wins. |
| `lib/parser/prose.mjs` | chunks free-form prose for LLM. |
| `lib/ir/builder.mjs` | blocks -> IR. auto-injects deps for rest kind. |
| `lib/ir/validator.mjs` | ajv wrapper around the schema. |
| `lib/ir/schema.mjs` | IR_V1 schema. `buildAjvSchema` inlines the recursive `stmt` so ajv can resolve `$ref`. |
| `lib/deps/resolver.mjs` | reverse-indexed phrase -> vcpkg port map. |
| `lib/deps/library-map.json` | the curated map (~40 entries). |
| `lib/llm/ollama.mjs` | ollama client. `extractIR`, `resolveUnknownDep`, `regenerateCpp`. structured output via the `format` parameter. |
| `lib/codegen/emit.mjs` | IR -> C++ source. handles all stmt kinds. |
| `lib/codegen/cmake.mjs` | IR -> CMakeLists.txt + vcpkg.json + transitive deps. |
| `lib/build/runner.mjs` | spawn-based subprocess wrapper. binary allowlist. |
| `lib/build/repair.mjs` | the compile-error repair loop. |

## design decisions

### why a strict IR

sending free-form text to an LLM and getting code back works for
small things, but the error mode is "LLM hallucinated something
absurd." the IR is a contract: the LLM produces JSON, ajv validates
it, the codegen only has to handle well-formed input. the LLM is
constrained to a fixed schema, so it can't invent a non-existent
library port or a `kind` the codegen doesn't know.

### why a structured DSL AND an LLM

the structured DSL handles 80% of programs: print, ask, function
declarations, require, simple behaviors. it's deterministic, fast,
and offline-capable. the LLM is the fallback for the long tail:
arbitrary prose, complex control flow, libraries we haven't mapped
yet. both paths converge on the same IR, so the codegen doesn't care
where the IR came from.

### why vcpkg and not system packages

vcpkg gives reproducible builds. `vcpkg install` in manifest mode
reads `vcpkg.json` and produces a deterministic dependency tree.
`vcpkg_installed/` is per-project, so there's no global state.
`CMAKE_TOOLCHAIN_FILE=.../vcpkg.cmake` makes cmake find the right
versions without any system-wide installs.

### why no fmt::print

fmt v12 has a libstdc++ ABI issue: linking `fmt::print` in some
configurations pulls in a different std::string layout. the emitter
includes `<fmt/core.h>` for users who want to use it, but the
default `print` stmt emits `std::cout << ...` to dodge the link
problem. users can add `fmt::print(...)` via the `raw` stmt if they
know what they're doing.

### why a 5-attempt repair cap

in practice, one LLM round on a clean IR fixes ~80% of compile
errors. two rounds fix ~95%. past three, you're in a loop where the
LLM keeps reintroducing the same bug. five is the cap because the
LLM call is slow (5-30s) and the value drops off fast.

## safety

- subprocess invocations use `spawn(cmd, args, { shell: false })` with
  a hard-coded allowlist of binaries. no string interpolation into
  shell. the allowlist lives in `lib/build/runner.mjs` and is
  consulted before any `spawn` call.
- the c++ emitter uses `JSON.stringify` for all user strings, which
  escapes `\\`, `"`, and control characters correctly. there's no
  path where user text ends up unescaped in a c++ token.
- the dep resolver's reverse index is case-insensitive substring
  match; the LLM fallback is gated on a curated allowlist of vcpkg
  ports defined in `lib/deps/library-map.json`. the LLM cannot
  suggest a port outside the allowlist, and the resolver drops
  anything it returns that isn't in the map (see
  `tests/integration/resolver-allowlist.test.mjs`).
- the `run` binary allowlist is checked before spawn, not after. if
  someone passes a custom binary, it gets rejected with a clear
  error before any process is started.

## testing

| level | what | how |
|-------|------|-----|
| unit | parser, IR builder, dep resolver, codegen, cmake emitter | node:test, no external deps |
| integration | full pipeline offline (parse + IR + codegen + cmake emit) | node:test |
| negative | empty input, empty IR, malformed dep, missing function body | node:test |
| security | shell-metachar escape, binary allowlist, spawn form | node:test |
| e2e | real compile + run, skips if g++/cmake/vcpkg missing | node:test |
| performance | 200-line .nlp under 2s | node:perf_hooks |

see `tests/` for the full list.
