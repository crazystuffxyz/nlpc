# examples

each `.nlp` file in this directory compiles to a working binary.

## hello.nlp

the minimum. one `print` statement.

```
Create a console application.

When the program starts:
    print Hello, world!
```

## greeter.nlp

introduces `Require` and a function declaration.

```
Create a console application.

Require the fmt library.

Make a function called greet that takes a person's name and returns a greeting.

When the program starts:
    ask the user for their name
    print the greeting
```

## rest-server.nlp

rest application with routes. setting `Application: type: REST API`
auto-injects `cpp-httplib`.

```
Application:
    type: REST API

Require the HTTP client library.
Require the JSON parser library.

When the program starts:
    serve on port 8080

GET /hello
POST /echo
```

## file-renamer.nlp

shows `for each` and multiple `ask` statements.

```
Create a console application.

When the program starts:
    ask the user for directory path
    ask the user for old extension
    ask the user for new extension
    for each file in directory
        rename file replacing old extension with new extension
```

the for body is best handled by the LLM in non-trivial cases.

## json-config.nlp

combines a function declaration with a require.

```
Require the JSON parser library.

Make a function called load_config that takes a path and returns the contents.

When the program starts:
    ask the user for the config path
    print the config
```

## running

```
nlpc compile examples/hello.nlp
nlpc compile examples/greeter.nlp
nlpc compile examples/rest-server.nlp
```

each produces a `build-out/<name>/build/<name>` binary.
