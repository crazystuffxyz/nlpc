// cmake + vcpkg emitter
import { resolveRequirements, lookup } from '../deps/resolver.mjs';

// vcpkg.json's top-level `name` is a package name, which vcpkg
// validates against a strict regex: lowercase alphanumeric +
// hyphens, no underscores, no dots, must start with a letter.
// our internal program names use `slug()` which keeps underscores
// (c++ identifiers are fine with them). derive a vcpkg-safe
// package name separately from the c++ project name.
function vcpkgName(n) {
  return String(n).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

export function emitProject(ir, programName) {
  const name = programName || ir.program.name || 'app';
  const vpkgName = vcpkgName(name);
  const reqs = resolveRequirements(ir.requirements || []);
  const vcpkg = {
    name: vpkgName,
    version: '0.1.0',
    dependencies: reqs.packages || [],
  };
  // features
  if (reqs.features && Object.keys(reqs.features).length) {
    vcpkg.features = {};
    for (const [pkg, feats] of Object.entries(reqs.features)) {
      if (feats.length) vcpkg.features[pkg] = { description: 'features for ' + pkg, dependencies: feats.map(f => `${pkg}[${f}]`) };
    }
  }
  // cmake
  const cmake = renderCmake(name, vcpkg.dependencies, ir);
  return { cmake, vcpkg: JSON.stringify(vcpkg, null, 2), name, packages: vcpkg.dependencies, unknown: reqs.unknown };
}

function renderCmake(name, deps, ir) {
  const lines = [];
  lines.push(`cmake_minimum_required(VERSION 3.19)`);
  lines.push(`project(${name} CXX)`);
  lines.push(`set(CMAKE_CXX_STANDARD 20)`);
  lines.push(`set(CMAKE_CXX_STANDARD_REQUIRED ON)`);
  lines.push('');
  // find_package per dep
  const findMap = {
    'fmt': 'find_package(fmt CONFIG REQUIRED)',
    // spdlog's CMake config does find_dependency(fmt) itself when
    // SPDLOG_FMT_EXTERNAL is set. leave the default (bundled fmt) to
    // avoid an ABI mismatch with the spdlog port that vcpkg builds.
    'spdlog': 'find_package(spdlog CONFIG REQUIRED)',
    'spdlog-header-only': 'find_package(spdlog CONFIG REQUIRED)',
    'nlohmann-json': 'find_package(nlohmann_json CONFIG REQUIRED)',
    // bug: vcpkg's cpp-httplib port ships a CMake config (httplibConfig.cmake)
    // that defines the httplib::httplib IMPORTED target and exposes the
    // include dir. skipping find_package meant the link step later
    // exploded with "Target links to target 'httplib::httplib' but the
    // target was not found" - because CMake never created the alias.
    'cpp-httplib': 'find_package(httplib CONFIG REQUIRED)',
    'cli11': 'find_package(CLI11 CONFIG REQUIRED)',
    'yaml-cpp': 'find_package(yaml-cpp CONFIG REQUIRED)',
    'tomlplusplus': 'find_package(toml++ CONFIG REQUIRED)',
    'gtest': 'find_package(GTest CONFIG REQUIRED)',
    'catch2': 'find_package(Catch2 CONFIG REQUIRED)',
    'benchmark': 'find_package(benchmark CONFIG REQUIRED)',
    'abseil': 'find_package(absl CONFIG REQUIRED)',
    'eigen3': 'find_package(Eigen3 CONFIG REQUIRED)',
    'openssl': 'find_package(OpenSSL REQUIRED)',
    'sqlite3': 'find_package(SQLite3 CONFIG REQUIRED)',
    'boost': 'find_package(Boost CONFIG REQUIRED)',
    'asio': 'find_package(asio CONFIG REQUIRED)',
    'glfw3': 'find_package(glfw3 CONFIG REQUIRED)',
    'sfml': 'find_package(SFML CONFIG REQUIRED COMPONENTS window graphics system)',
    'sdl2': 'find_package(SDL2 CONFIG REQUIRED)',
    'curl': 'find_package(CURL CONFIG REQUIRED)',
    'cpr': 'find_package(cpr CONFIG REQUIRED)',
    'zlib': 'find_package(ZLIB REQUIRED)',
    // the entries below were missing - the library-map has them as
    // vcpkg ports but cmake.mjs had no find_package / link entries.
    // `Require hiredis` etc used to compile main.cpp, but the link
    // step failed because no IMPORTED target was created.
    'imgui': 'find_package(imgui CONFIG REQUIRED)',
    'qt': 'find_package(Qt6 COMPONENTS Widgets REQUIRED)',
    'wxwidgets': 'find_package(wxWidgets REQUIRED COMPONENTS core base)',
    'libpq': 'find_package(PostgreSQL REQUIRED)',
    'mysql-connector-cpp': 'find_package(mysql-connector-cpp CONFIG REQUIRED)',
    'hiredis': 'find_package(hiredis CONFIG REQUIRED)',
    'grpc': 'find_package(gRPC CONFIG REQUIRED)',
    'protobuf': 'find_package(Protobuf CONFIG REQUIRED)',
    'msgpack': 'find_package(msgpack-c CONFIG REQUIRED)',
    'date': 'find_package(date CONFIG REQUIRED)',
    'magic-enum': 'find_package(magic_enum CONFIG REQUIRED)',
    'frozen': 'find_package(frozen CONFIG REQUIRED)',
    'tinyxml2': 'find_package(tinyxml2 CONFIG REQUIRED)',
    'fast-cpp-csv-parser': 'find_package(csv-parser CONFIG REQUIRED)',
  };
  const links = [];
  for (const d of deps) {
    const fn = findMap[d];
    if (fn) {
      if (Array.isArray(fn)) lines.push(...fn);
      else lines.push(fn);
    }
    if (d === 'cpp-httplib') links.push('httplib::httplib');
    else if (d === 'nlohmann-json') links.push('nlohmann_json::nlohmann_json');
    else if (d === 'fmt') links.push('fmt::fmt');
    else if (d === 'spdlog') links.push('spdlog::spdlog', 'Threads::Threads');
    else if (d === 'gtest') links.push('GTest::gtest');
    else if (d === 'benchmark') links.push('benchmark::benchmark');
    else if (d === 'boost') links.push('Boost::boost');
    else if (d === 'asio') links.push('asio::asio');
    else if (d === 'openssl') links.push('OpenSSL::SSL', 'OpenSSL::Crypto');
    else if (d === 'sqlite3') links.push('SQLite::SQLite3');
    else if (d === 'sfml') links.push('sfml-graphics', 'sfml-window', 'sfml-system');
    else if (d === 'sdl2') links.push('SDL2::SDL2');
    else if (d === 'curl') links.push('CURL::libcurl');
    else if (d === 'cpr') links.push('cpr::cpr');
    else if (d === 'zlib') links.push('ZLIB::ZLIB');
    else if (d === 'eigen3') links.push('Eigen3::Eigen');
    else if (d === 'cli11') links.push('CLI11::CLI11');
    else if (d === 'yaml-cpp') links.push('yaml-cpp::yaml-cpp');
    else if (d === 'tomlplusplus') links.push('toml++::toml++');
    else if (d === 'abseil') links.push('absl::absl');
    else if (d === 'glfw3') links.push('glfw');
    // link entries for the ports whose find_package was added in this
    // fix. some ports don't ship a canonical IMPORTED target, so we
    // fall back to the vcpkg convention (e.g. `libpq::libpq`,
    // `Qt6::Widgets`). if a port doesn't have one, link the package
    // name itself - cmake's find_package MODULE-mode at least
    // exposes include dirs and a link library by that name.
    else if (d === 'imgui') links.push('imgui::imgui');
    else if (d === 'qt') links.push('Qt6::Widgets');
    else if (d === 'wxwidgets') links.push('wx::core', 'wx::base');
    else if (d === 'libpq') links.push('PostgreSQL::PostgreSQL');
    else if (d === 'mysql-connector-cpp') links.push('mysql-connector-cpp::mysql-connector-cpp', 'mysql-connector-cpp::mysql-connector-cpp-jdbc');
    else if (d === 'hiredis') links.push('hiredis::hiredis');
    else if (d === 'grpc') links.push('gRPC::grpc++');
    else if (d === 'protobuf') links.push('protobuf::libprotobuf');
    else if (d === 'msgpack') links.push('msgpack-c');
    else if (d === 'date') links.push('date::date');
    else if (d === 'magic-enum') links.push('magic_enum::magic_enum');
    else if (d === 'frozen') links.push('frozen::frozen');
    else if (d === 'tinyxml2') links.push('tinyxml2::tinyxml2');
    else if (d === 'fast-cpp-csv-parser') links.push('csv-parser');
  }
  lines.push('');
  lines.push(`add_executable(${name} main.cpp)`);
  if (links.length) lines.push(`target_link_libraries(${name} PRIVATE ${[...new Set(links)].join(' ')})`);
  if (ir.program.kind === 'rest') {
    lines.push(`target_compile_definitions(${name} PRIVATE NLPC_REST=1)`);
  }
  lines.push('');
  return lines.join('\n');
}
