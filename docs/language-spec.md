# language spec

the `.nlp` DSL is intentionally small. this document covers everything
the compiler understands.

## file shape

a `.nlp` file is a sequence of statements. statements fall into three
buckets:

- **requirements** - external libraries the program needs
- **declarations** - functions and variables
- **behaviors** - things that happen on a trigger

anything that doesn't match a known pattern is treated as free-form
prose. in offline mode (`NLPC_OFFLINE=1`) the prose is ignored. with
ollama running, prose is chunked and sent to the LLM to extract
structured IR.

## requirements

syntax:

```
Require the <thing> library.
Need: <thing>
Use the <thing> library.
```

`<thing>` is matched against `lib/deps/library-map.json`. the resolver
does an exact lookup, then falls back to substring match. if still
nothing, it's added to the unknown list and the LLM gets a chance to
map it (with a curated vcpkg allowlist - the LLM cannot invent
arbitrary port names).

currently mapped:

| phrase | vcpkg port |
|--------|------------|
| fmt / format | fmt |
| spdlog / logging | spdlog |
| json / nlohmann | nlohmann-json |
| http / rest | cpp-httplib |
| curl | curl / cpr |
| graphics / 2d | sfml |
| sdl | sdl2 |
| opengl / glfw | glfw3 |
| imgui | imgui |
| qt | qt |
| openssl / ssl / tls | openssl |
| sqlite / database | sqlite3 |
| postgres | libpq |
| mysql | mysql-connector-cpp |
| redis | hiredis |
| gtest | gtest |
| catch2 | catch2 |
| benchmark | benchmark |
| eigen / linear algebra | eigen3 |
| toml | tomlplusplus |
| yaml | yaml-cpp |
| cli / argparse | cli11 |
| zlib / compression | zlib |
| boost | boost |
| asio / tcp / udp | asio |

## declarations

### functions

```
Make a function called <name> that takes <args> and returns <type>.
Make a function called <name>(<args>) that returns <type>.
```

`<name>` is a c++ identifier. `<args>` can be either a parenthesized
list (e.g. `(int n, string s)`) or natural language ("a person's
name", "a number"). in the natural-language form, the trailing
significant word becomes the parameter name.

`<type>` is one of: `int`, `double`, `bool`, `string`, `void`, `json`,
`bytes`, `vector<string>`, `vector<int>`. words like "list of strings"
also map.

### variables

```
Set x = 5.
Set greeting = "hello".
```

top-level `Set` statements become global variables in the generated
c++.

## behaviors

### start

```
When the program starts:
    <stmt>
    <stmt>
```

this is `main()`. the body is a sequence of statements, one per
indented line.

### routes (rest applications)

```
GET /hello
POST /echo
PUT /users/:id
DELETE /users/:id
```

each route becomes a behavior with `trigger: 'route'`. the body of
the route is filled in by the LLM in non-trivial cases, or by the
inline emitter for trivial handlers.

## statements

| kind | syntax | generated c++ |
|------|--------|---------------|
| print | `print Hello, world!` | `std::cout << "..." << std::endl` |
| ask | `ask the user for their name` | prompt + `std::getline` into a `std::string` |
| set | `set x = 5` | `auto x = 5;` |
| call | `call helper()` | `helper()` |
| return | `return 0` | `return 0;` |
| http_get | `GET /path` | `httplib::Client(...).Get("/path")` |
| http_serve | `serve on port 8080` | `svr.listen("0.0.0.0", 8080)` |
| http_route | `GET /hello` | `svr.get("/hello", handler)` |
| json_load | (LLM-extracted) | `nlohmann::json::parse(ifstream)` |
| json_save | (LLM-extracted) | `ofstream << nlohmann::json(...).dump()` |
| file_read | (LLM-extracted) | `ifstream + stringstream` |
| file_write | (LLM-extracted) | `ofstream << ...` |
| log | (LLM-extracted) | `spdlog::info(...)` |
| sleep | (LLM-extracted) | `std::this_thread::sleep_for(...)` |
| assert | (LLM-extracted) | `assert(...)` |
| for | `for each x in y` | ranged-for (with LLM fill for body) |
| if | `if x > 0:` | if-stmt (with LLM fill for body) |
| raw | (LLM-extracted) | verbatim c++ emitted into the body |

`raw` is the escape hatch: the LLM can drop in arbitrary c++ when no
other stmt kind fits. use sparingly.

## application kind

```
Create a console application.
Create a REST API.
Application:
    type: REST API
```

kinds:

- `console` (default) - terminal program with a `main()`
- `rest` - httplib server, listens on port 8080
- `window` - reserved for SDL/SFML windowed apps (WIP)
- `web` - reserved (WIP)
- `cli` - alias for `console` with CLI arg parsing (WIP)
- `library` - emits a static lib (WIP)

## the IR

the IR is JSON conforming to `lib/ir/schema.mjs`. top level:

```json
{
  "program": { "name": "hello", "kind": "console", "entry": "main" },
  "requirements": [{ "name": "fmt", "source": "vcpkg" }],
  "declarations": [
    {
      "kind": "function",
      "name": "greet",
      "params": [{ "name": "name", "type": "string" }],
      "returns": "string",
      "body": []
    }
  ],
  "behaviors": [
    {
      "trigger": "start",
      "body": [
        { "kind": "ask", "text": "Name", "name": "name" },
        { "kind": "print", "text": "Hello, world!" }
      ]
    }
  ],
  "constraints": [{ "kind": "cxx_standard", "value": "20" }]
}
```

`requirements` and `declarations` are flat arrays. `behaviors` is a
flat array of `{trigger, body}` pairs - one per trigger source.

## unknown / unsupported

if the parser sees a line it doesn't recognize, it goes into the
`prose` array. with ollama available, the prose is sent as
`FREE-FORM PROSE:` and the LLM is expected to convert it into IR
statements. without ollama, the prose is silently dropped - so the
generated program will be incomplete.

this is intentional: the structured DSL is the supported way to
write programs. the LLM path is best-effort and only useful for
drafting.
