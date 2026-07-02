# unbun

[![npm version](https://img.shields.io/npm/v/unbunjs.svg)](https://www.npmjs.com/package/unbunjs) [![CI](https://github.com/cc-friend/unbun/actions/workflows/ci.yml/badge.svg)](https://github.com/cc-friend/unbun/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/npm/l/unbunjs.svg)](./LICENSE)

**English** | [中文](README.zh.md) | [Français](README.fr.md)

Inspect and extract embedded modules from [Bun compiled binaries](https://bun.sh/docs/bundler/executables) (`bun build --compile`).

When you compile a JavaScript/TypeScript project with `bun build --compile`, Bun bundles your source code, bytecode, WASM files, native addons, and other assets into a single standalone executable. **unbun** lets you look inside these binaries, list all embedded modules, preview their contents, and extract them to disk.

[CC2Node](https://github.com/cc-friend/cc2node) is a CLI tool based on unbun, it can convert any Bun-compiled Claude Code into a pure-Node build that runs on plain Node v18 or later.

## Install

```bash
# Global install (recommended for CLI usage)
npm i -g unbunjs   # or: bun i -g unbunjs

# Local install (for library usage)
npm i unbunjs      # or: bun i unbunjs
```

Or run directly with npx:

```bash
npx unbunjs ./my-compiled-app  # or: bunx unbunjs ./my-compiled-app
```

## CLI Usage

### List modules

```bash
unbun list ./myapp
```

```
Bun Compiled Binary: ./myapp
Payload offset: 4932608 (4.70 MB)
Payload size:   1871424 (1.78 MB)
Flags:          disable_default_env_files
Modules:        4

  #  Entry  Loader  Format  Enc     Side          Source      Bytecode      SrcMap  Name
----------------------------------------------------------------------------------------------------------------------------------
  0   >>>   js      esm     utf8    server     456.30 KB       3.21 MB           -  /$bunfs/root/src/app.js
  1         json    none    utf8    server       1.80 KB             -           -  /$bunfs/root/config.json
  2         wasm    none    binary  client     851.20 KB             -           -  /$bunfs/root/math.wasm
  3         napi    none    binary  client     624.00 KB             -           -  /$bunfs/root/crypto.node
```

The `>>>` marker indicates the entry point module.

**JSON output:**

```bash
unbun list ./myapp --json
```

```json
{
  "file": "./myapp",
  "payload_start": 4932608,
  "payload_size": 1871424,
  "flags": {
    "disable_default_env_files": true,
    "disable_autoload_bunfig": false,
    "disable_autoload_tsconfig": false,
    "disable_autoload_package_json": false
  },
  "modules": [
    {
      "index": 0,
      "name": "/$bunfs/root/src/app.js",
      "contents_length": 467251,
      "bytecode_length": 3366912,
      "loader": "js",
      "module_format": "esm",
      "encoding": "utf8",
      "side": "server",
      "is_entry_point": true
    }
  ]
}
```

You can also just pass the binary path directly (no subcommand):

```bash
unbun ./myapp
```

### Extract modules

Extract all modules to a directory:

```bash
unbun extract ./myapp ./output
```

```
   456.30 KB  output/src/app.js
     3.21 MB  output/src/app.js.bytecode
     1.80 KB  output/config.json
   851.20 KB  output/math.wasm
   624.00 KB  output/crypto.node
```

Extract specific modules using a filter:

```bash
unbun extract ./myapp ./output -m app.js
unbun extract ./myapp ./output -m 0          # by index
unbun extract ./myapp ./output -m .wasm      # all WASM files
```

The filter matches against both the module index and module name (substring match).

If no output directory is specified, it defaults to `./extracted`.

### Preview source

Preview the first N lines of a module's source code:

```bash
unbun preview ./myapp app.js        # first 50 lines (default)
unbun preview ./myapp app.js 100    # first 100 lines
unbun preview ./myapp 0             # by module index
```

```
Module: /$bunfs/root/src/app.js (456.30 KB, 4820 lines)
────────────────────────────────────────────────────────────────────────────────
// @bun
import{serve}from"bun";import{readFileSync}from"node:fs";
var router=new Map;router.set("/",()=>new Response("OK"));...
```

### Hex dump

Inspect raw bytes of a module:

```bash
unbun hexdump ./myapp math.wasm        # first 512 bytes (default)
unbun hexdump ./myapp math.wasm 256    # first 256 bytes
```

```
Module: /$bunfs/root/math.wasm
Size: 851.20 KB
First 512 bytes:

  004b4a00  00 61 73 6d 01 00 00 00 01 0c 03 60 01 7f 01 7f  .asm.......`....
  004b4a10  60 02 7f 7f 01 7f 60 00 00 03 04 03 00 01 02 05  `.....`.........
```

### All commands

| Command | Alias | Description |
|---|---|---|
| `unbun list <binary>` | `ls` | List all embedded modules |
| `unbun list <binary> --json` | | List as JSON |
| `unbun extract <binary> [dir]` | `x` | Extract all modules |
| `unbun extract <binary> [dir] -m <filter>` | | Extract matching modules |
| `unbun preview <binary> <filter> [lines]` | `cat` | Preview source text |
| `unbun hexdump <binary> <filter> [bytes]` | `hex` | Hex dump of contents |
| `unbun <binary>` | | Shorthand for `list` |
| `unbun --help` | `-h` | Show help |
| `unbun --version` | `-v` | Show version |

## Library API

Use unbun programmatically in your own tools:

```typescript
import {
  parse,
  parseBuffer,
  isBunBinary,
  getModuleSource,
  getModuleContents,
  getModuleBytecode,
  getModuleSourcemap,
  findModule,
  findModules,
} from "unbunjs";

// Quick check
if (isBunBinary("./myapp")) {
  console.log("This is a Bun compiled binary!");
}

// Parse the binary
const binary = parse("./myapp");

console.log(`Modules: ${binary.modules.length}`);
console.log(`Payload size: ${binary.offsets.byte_count} bytes`);

// List all modules
for (const mod of binary.modules) {
  console.log(`${mod.name} (${mod.loader}, ${mod.contents_length} bytes)`);
}

// Find a specific module
const entry = findModule(binary, "app.js");
if (entry) {
  // Get source as string
  const source = getModuleSource(binary, entry);
  console.log(source.slice(0, 200));

  // Get raw contents as Buffer
  const buf = getModuleContents(binary, entry);

  // Get bytecode (empty Buffer if none)
  const bytecode = getModuleBytecode(binary, entry);

  // Get sourcemap (empty Buffer if none)
  const sourcemap = getModuleSourcemap(binary, entry);
}

// Find all matching modules
const wasmModules = findModules(binary, ".wasm");

// Parse from a Buffer instead of file path
import { readFileSync } from "fs";
const data = readFileSync("./myapp");
const binary2 = parseBuffer(data);
```

### API Reference

#### `parse(filePath: string): ParsedBunBinary`

Parse a Bun compiled binary from a file path. Reads the entire file into memory.

#### `parseBuffer(data: Buffer): ParsedBunBinary`

Parse a Bun compiled binary from a Buffer. Useful when you already have the data in memory.

#### `isBunBinary(filePath: string, searchBytes?: number): boolean`

Quick check whether a file is a Bun compiled binary, scanning the tail of the file for the trailer instead of loading the whole thing. The default window (32 MiB) covers Linux, Windows, and macOS binaries. On macOS the trailer can sit over a megabyte from the end, behind the code signature. Pass a larger `searchBytes` for unusually large signed macOS binaries.

#### `getModuleSource(parsed, module): string`

Get the source contents of a module as a UTF-8 string.

#### `getModuleContents(parsed, module): Buffer`

Get the raw source contents of a module as a Buffer.

#### `getModuleBytecode(parsed, module): Buffer`

Get the JSC bytecode of a module. Returns an empty Buffer if no bytecode is embedded.

#### `getModuleSourcemap(parsed, module): Buffer`

Get the serialized sourcemap of a module. Returns an empty Buffer if no sourcemap is embedded.

#### `findModule(parsed, filter): BunModule | undefined`

Find the first module whose name contains `filter`, or whose index matches `filter`.

#### `findModules(parsed, filter): BunModule[]`

Find all modules matching the filter.

### Types

```typescript
interface ParsedBunBinary {
  offsets: Offsets;
  modules: BunModule[];
  payload: Buffer;
  payload_start: number;
  compile_exec_argv: string;
  flags: CompileFlags;
}

interface BunModule {
  index: number;
  name: string;              // e.g. "/$bunfs/root/src/index.js"
  contents_offset: number;
  contents_length: number;
  sourcemap_length: number;
  bytecode_length: number;
  module_info_length: number;
  bytecode_origin_path: string;
  encoding: string;           // "binary" | "latin1" | "utf8"
  loader: string;             // "js" | "ts" | "jsx" | "tsx" | "css" | "json" | "wasm" | "napi" | ...
  module_format: string;      // "none" | "esm" | "cjs"
  side: string;               // "server" | "client"
  is_entry_point: boolean;
}

interface CompileFlags {
  disable_default_env_files: boolean;
  disable_autoload_bunfig: boolean;
  disable_autoload_tsconfig: boolean;
  disable_autoload_package_json: boolean;
}
```

## How It Works

Bun compiled binaries use a well-defined format from Bun's open-source [`StandaloneModuleGraph.zig`](https://github.com/oven-sh/bun/blob/main/src/StandaloneModuleGraph.zig). The embedded blob is identical across platforms:

```
┌─────────────────────────┐
│   Platform Binary       │  ← ELF / Mach-O / PE (Bun runtime)
├─────────────────────────┤  ← payload_start
│   Payload Data          │  ← module names, source, bytecode, WASM,
│   (byte_count bytes)    │    native addons, sourcemaps + the module table
├─────────────────────────┤
│   Offsets               │  ← { byte_count, modules_ptr, ... }
├─────────────────────────┤
│   Trailer (16 bytes)    │  ← "\n---- Bun! ----\n"
└─────────────────────────┘
```

It's appended to the file on Linux (ELF) and embedded in a section on macOS (Mach-O) / Windows (PE); unbun finds it via the last trailer. Each module entry holds `StringPointer`s (u32 offset + length) into the payload for its name, contents, sourcemap, and bytecode.

Several layouts have shipped as Bun evolved. unbun auto-detects all of them by structure (not version), validating every module's pointers before accepting one:

| Layout | Offsets | Module entry | Roughly | Notable fields |
|---|---|---|---|---|
| Minimal | 24 B | 32 B | Bun ~1.0 | name / contents / sourcemap + loader byte |
| Compact | 24 B | 36 B | Bun ~1.1 | + `bytecode`, `encoding`/`loader`/`module_format` |
| Midsize | 32 B | 36 B | Bun ~1.2 | + Offsets `compile_exec_argv_ptr` / `flags` |
| Extended | 32 B | 52 B | Bun ~1.3+ | + `module_info` / `bytecode_origin_path` / `side` |

## Supported Platforms

unbun supports Bun compiled binaries from **all platforms** and **all Bun versions**:

- **Linux** (x64, arm64, x64-musl, arm64-musl): ELF
- **macOS** (x64, arm64): Mach-O
- **Windows** (x64, arm64): PE
- **Bun versions**: 1.0 through the latest canary: every module graph layout (see [How It Works](#how-it-works)) is auto-detected

## Development

```bash
bun install        # install dependencies
bun run checkall   # type-check + lint + format-check + tests (no writes)
bun run fixall     # auto-fix lint + format
bun test           # run the test suite
bun run build      # compile TypeScript to dist/
```

Linting and formatting are handled by [Biome](https://biomejs.dev/). The test suite runs on [`bun test`](https://bun.sh/docs/cli/test) and builds its own synthetic fixtures, so it needs no external binaries. It also parses a set of tiny committed fixtures in `test/fixtures/real/` (truncated tails of real `bun build --compile` output from Bun 1.0 to 1.3, a few hundred bytes each) as ground truth for every layout. Regenerate them with `scripts/e2e/make-fixtures.mjs`.

### Checking against Claude Code releases

`bun run check:claude-code` downloads the latest [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code) binaries for every platform and checks that unbun parses and extracts each one. Everything is cached under `.cache/` (gitignored, ~1.8 GB). Manual only and not part of `bun test`, `checkall`, or CI.

### Releasing

Releases are automated with [vbt](https://www.npmjs.com/package/vbt) and GitHub
Actions. Bumping the version rewrites `package.json` and the CLI's version
string, then commits, tags, and pushes:

```bash
bun run release:patch   # 1.0.0 -> 1.0.1
bun run release:minor   # 1.0.0 -> 1.1.0
bun run release:major   # 1.0.0 -> 2.0.0
```

Pushing the resulting `v*` tag triggers the **Publish** workflow, which
re-runs the checks and publishes to npm with provenance. It requires an
`NPM_TOKEN` repository secret (an npm automation token).

## Related Projects

- [CC2Node](https://github.com/cc-friend/cc2node): Convert any Bun-compiled Claude Code into a pure-Node build that runs on plain Node v18 or later
- [Bun Standalone Executables docs](https://bun.sh/docs/bundler/executables): Official Bun documentation

## License

MIT
