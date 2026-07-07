# nlpc

a compiler that takes natural-language program specs and lowers them to
runnable c++ executables. write `hello.nlp`, get `hello.exe`.

```
Create a console application.

Require the fmt library.

Make a function called greet that takes a person's name and returns a greeting.

When the program starts:
    ask the user for their name
    print the greeting
```

compiles to a working binary that prompts, reads, and prints, with `fmt`
linked via vcpkg and `CMakeLists.txt` generated automatically.

## why

most "code from english" projects ask an LLM to spit out code. the
interesting part is the tooling around it: a strict intermediate
representation, a dependency resolver that maps phrases like "graphics
library" to vcpkg ports, a build pipeline that fixes its own compile
errors, and a real linker at the end. this is the language side of
that.

## install

the published package lives on github, not the public npm registry:

```
npm install -g crazystuffxyz/nlpc
```

or for a single-binary install that doesn't need node on your path,
grab the latest release from
[github releases](https://github.com/crazystuffxyz/nlpc/releases).
extract the tarball and run `./install.sh` (mac/linux) or
`install.cmd` (windows).

if you want to hack on it:

```
git clone https://github.com/crazystuffxyz/nlpc.git
cd nlpc
npm install
```

you also need a working c++ toolchain locally:

- g++ or clang++ (c++20)
- cmake
- vcpkg at `$VCPKG_ROOT` (or pass `--vcpkg-root <path>`)
- ollama running at `http://127.0.0.1:11434` (only required for the
  free-form-prose path; the structured DSL works offline)

if you don't have ollama, set `NLPC_OFFLINE=1` and the compiler skips
the LLM entirely.

## usage

```
nlpc compile path/to/program.nlp            # compile + run
nlpc compile program.nlp --no-run           # build only
nlpc compile program.nlp -o ./out           # custom out dir
nlpc compile program.nlp --keep-build       # don't wipe build dir
nlpc watch path/to/program.nlp              # rebuild + rerun on save
nlpc doctor                                 # check toolchain
nlpc setup                                  # interactive tool installer
nlpc build ./mydir                          # build all entries in a project
nlpc register                               # bind .nlp to nlpc on this OS
nlpc add-to-path                            # add nlpc to user PATH
nlpc update                                 # check for a newer version
```

`watch` recompiles and reruns the binary every time the .nlp file is
saved. it debounces rapid edits (200ms) and kills the prior binary
before relaunching. ctrl-c to stop.

`doctor` prints `[ok]`/`[FAIL]` for node, c++, cmake, vcpkg, and ollama.
if anything's red, fix it before compiling.

## the language

`.nlp` is a tiny DSL. every file has three kinds of statements:
requirements, declarations, and behaviors. the structured parser
recognizes these; everything else is treated as free-form prose and
sent to ollama (unless `NLPC_OFFLINE=1`).

### requirements

```
Require the fmt library.
Require the JSON parser library.
Require the HTTP client library.
```

the resolver maps each phrase to a vcpkg port. phrases it doesn't
recognize get sent to ollama with a curated allowlist. currently
~40 phrases are mapped (fmt, nlohmann-json, cpp-httplib, sfml,
sqlite3, openssl, gtest, eigen3, ...). see `lib/deps/library-map.json`
for the full list.

### declarations

```
Make a function called greet that takes a person's name and returns a greeting.
```

types are inferred from words: `int`, `double`, `bool`, `string`,
`void`, `vector<string>`, `vector<int>`, etc.

### behaviors

```
When the program starts:
    ask the user for their name
    print the greeting
```

behaviors run on a trigger (`start`, `route:GET /path`,
`route:POST /path`, etc.). the body is a sequence of statements.

### application kind

```
Application:
    type: REST API
```

kinds: `console` (default), `rest`, `window`, `web`, `cli`,
`library`. setting `rest` auto-injects `cpp-httplib`.

### full example

```
// file: examples/rest-server.nlp
Application:
    type: REST API

Require the HTTP client library.
Require the JSON parser library.

When the program starts:
    serve on port 8080

GET /hello
POST /echo
```

## how it works

```
.nlp file
  -> parseStructured (regex DSL parser)
  -> buildIR (blocks -> JSON IR)
  -> validateIR (ajv against schema)
  -> resolveRequirements (phrase -> vcpkg port)
  -> emitCpp (IR -> main.cpp)
  -> emitProject (IR -> CMakeLists.txt + vcpkg.json)
  -> vcpkgInstall (vcpkg install in manifest mode)
  -> cmakeConfigure + cmakeBuild
  -> if compile failed -> repairLoop (ask LLM to fix, max 5 tries)
  -> run
```

the IR is a strict JSON schema (`lib/ir/schema.mjs`) with five sections:
`program`, `requirements`, `declarations`, `behaviors`, `constraints`.
the schema is recursive (bodies of stmts can contain stmts), which is
why `buildAjvSchema` exists - it inlines the `stmt` definition so ajv
can resolve the `$ref`.

the LLM only runs in two cases: when the structured parser can't make
sense of the input (prose-only), and when the compiler hits a build
error and needs repair.

## safety

- all subprocess invocations go through `spawn` with `shell: false` and
  an explicit binary allowlist (`cmake`, `g++`, `vcpkg`, `ninja`, etc.)
- string interpolation into C++ output uses `JSON.stringify`, which
  escapes backslashes and double quotes correctly
- there's no `system()` or `sh -c` path anywhere in the emitter

## tests

```
npm test                  # unit + integration + negative + security
npm run test:e2e          # real compile + run (skips if no g++)
npm run test:perf         # 200-line .nlp under 2s budget
```

32 → 145 tests covering the parser, IR builder, dep resolver, codegen, cmake
emitter, and the runner's allowlist/injection defenses.

## changelog

**v1.0.1** (post-v1.0.0 audit) - 7 fixes from a background review that
survived the v1.0.0 fix loop:

- **RCE fix**: `name + system("evil")` no longer compiles to a
  function call. EXPR_RE and cppRhs now reject parens/brackets in
  expression context and any function-call shape before the
  expression guard.
- **if-cond fix**: `if x is positive:` no longer compiles to
  invalid c++. new isValidCond() requires at most one
  whitespace-separated letter-only token.
- **top-level set fix**: `set x = 5` now produces `int x = 5;`,
  not `std::string x = "5";`. builder parses the value via
  parseValue and tags the IR with isString + type; emitter
  honors them.
- **parseValue fix**: `"a" + "b` no longer gets stripped to a
  string with inner quotes. inner containing `+` or unescaped
  quotes falls through to the expression path.
- **bodySetResponse fix**: `call preserve()` no longer suppresses
  the 'ok' fallback. changed the substring check to an exact
  ident match.
- **cmake port coverage**: 14 ports (imgui, qt, wxwidgets, libpq,
  mysql-connector-cpp, hiredis, grpc, protobuf, msgpack, date,
  magic-enum, frozen, tinyxml2, fast-cpp-csv-parser) now have
  find_package and link entries.
- **openssl no longer forced**: openssl is no longer a forced
  cpp-httplib transitive. plain HTTP doesn't pull in the heavy
  ssl build.
- **resolver substring fix**: `lookup('')` returns null, `lookup('f')`
  returns null. longest-key-first ordering prevents short common
  substrings from matching before specific keys.

**v1.0.0** - first github release.

## building a standalone binary

`npm install -g crazystuffxyz/nlpc` works on any machine with node.
for a single-binary distribution that doesn't need node installed:

```
npm install -g esbuild pkg
npm run build:binary          # builds the host target (~37MB)
NLPC_BUILD_ALL=1 npm run build:binary   # all 5 OS/arch targets
```

artifacts land in `dist/nlpc-<os>-<arch>[.exe]`. the build script uses
`esbuild` to inline all imports into one `dist/nlpc.bundle.cjs`, then
`pkg` to wrap that in a node18 runtime. `pkg` downloads the node
binaries on first run via `pkg-fetch`.

the install script (`scripts/install.mjs`, exposed as `nlpc add-to-path`)
works on win/mac/linux from a single node.js source — no `.cmd`, no
`.sh`, no `setx`. PATH edits use PowerShell
`SetEnvironmentVariable` on windows and `~/.bashrc`/`~/.zshrc` on
mac/linux.

## license

MIT.
