// cmake + vcpkg emitter
import { resolveRequirements, lookup } from '../deps/resolver.mjs'; // deps

console.log('codegen/cmake.mjs load'); // trace

export function emitProject(ir, programName) { // main
  console.log('emitProject', programName); // trace
  const name = programName || ir.program.name || 'app'; // name
  const reqs = resolveRequirements(ir.requirements || []); // resolve
  const vcpkg = { // manifest
    name,
    version: '0.1.0',
    dependencies: reqs.packages || [],
  };
  // add transitive deps known
  const transitive = new Map(); // map
  for (const p of vcpkg.dependencies) { // loop
    if (p === 'cpp-httplib') transitive.set('openssl', []); // ssl
  }
  for (const [k] of transitive) if (!vcpkg.dependencies.includes(k)) vcpkg.dependencies.push(k); // add
  // features
  if (reqs.features && Object.keys(reqs.features).length) { // has
    vcpkg.features = {}; // init
    for (const [pkg, feats] of Object.entries(reqs.features)) { // loop
      if (feats.length) vcpkg.features[pkg] = { description: 'features for ' + pkg, dependencies: feats.map(f => `${pkg}[${f}]`) };
    }
  }
  // cmake
  const cmake = renderCmake(name, vcpkg.dependencies, ir); // render
  return { cmake, vcpkg: JSON.stringify(vcpkg, null, 2), name, packages: vcpkg.dependencies, unknown: reqs.unknown };
}

function renderCmake(name, deps, ir) { // cmake
  const lines = []; // lines
  lines.push(`cmake_minimum_required(VERSION 3.19)`); // min
  lines.push(`project(${name} CXX)`); // project
  lines.push(`set(CMAKE_CXX_STANDARD 20)`); // std
  lines.push(`set(CMAKE_CXX_STANDARD_REQUIRED ON)`); // req
  lines.push(''); // blank
  // find_package per dep
  const findMap = { // map dep -> find_package call
    'fmt': 'find_package(fmt CONFIG REQUIRED)',
    'spdlog': 'find_package(spdlog CONFIG REQUIRED)',
    'nlohmann-json': 'find_package(nlohmann_json CONFIG REQUIRED)',
    'cpp-httplib': '# cpp-httplib is header-only; nothing to find',
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
  };
  const links = []; // link libs
  for (const d of deps) { // loop
    const fn = findMap[d]; // find call
    if (fn) lines.push(fn); // push
    if (d === 'cpp-httplib') links.push('httplib::httplib'); // header
    else if (d === 'nlohmann-json') links.push('nlohmann_json::nlohmann_json');
    else if (d === 'fmt') links.push('fmt::fmt');
    else if (d === 'spdlog') links.push('spdlog::spdlog');
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
  }
  lines.push(''); // blank
  lines.push(`add_executable(${name} main.cpp)`); // exe
  if (links.length) lines.push(`target_link_libraries(${name} PRIVATE ${[...new Set(links)].join(' ')})`); // link
  if (ir.program.kind === 'rest') { // rest
    lines.push(`target_compile_definitions(${name} PRIVATE NLPC_REST=1)`); // def
  }
  lines.push(''); // blank
  return lines.join('\n');
}
