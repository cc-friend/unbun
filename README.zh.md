# unbun

[![npm version](https://img.shields.io/npm/v/unbunjs.svg)](https://www.npmjs.com/package/unbunjs) [![CI](https://github.com/cc-friend/unbun/actions/workflows/ci.yml/badge.svg)](https://github.com/cc-friend/unbun/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/npm/l/unbunjs.svg)](./LICENSE)

[English](README.md) | **中文** | [Français](README.fr.md)

检查并提取 [Bun编译的二进制文件](https://bun.sh/docs/bundler/executables)（`bun build --compile`）中的嵌入式模块。

当你使用 `bun build --compile` 编译一个 JavaScript/TypeScript 项目时，Bun 会把你的源代码、字节码、WASM 文件、原生插件以及其他资源打包进单个独立可执行文件中。**unbun** 让你能够查看这些二进制文件的内部，列出所有嵌入式模块，预览它们的内容，并将它们提取到磁盘上。

[cc2js](https://github.com/cc-friend/cc2js) 是一个基于 unbun 的 CLI 工具，它可以把任意经 Bun 编译的 Claude Code 转换为纯 Node 构建，从而在普通的 Node v18 及以上版本上运行。

## 安装

```bash
# Global install (recommended for CLI usage)
npm i -g unbunjs   # or: bun i -g unbunjs

# Local install (for library usage)
npm i unbunjs      # or: bun i unbunjs
```

或者直接用 npx 运行：

```bash
npx unbunjs ./my-compiled-app  # or: bunx unbunjs ./my-compiled-app
```

## CLI 用法

### 列出模块

```bash
unbun list ./myapp
```

```
Bun Compiled Binary: ./myapp
Payload offset: 4932608 (4.70 MB)
Payload size:   1871424 (1.78 MB)
Flags:          disable_default_env_files
Modules:        4

  #  Entry  Loader  Format  Enc      Side          Source      Bytecode      SrcMap  Name
----------------------------------------------------------------------------------------------------------------------------------
  0   >>>   js      esm     latin1   server     456.30 KB       3.21 MB           -  /$bunfs/root/src/app.js
  1         json    none    latin1   server       1.80 KB             -           -  /$bunfs/root/config.json
  2         wasm    none    binary   client     851.20 KB             -           -  /$bunfs/root/math.wasm
  3         napi    none    binary   client     624.00 KB             -           -  /$bunfs/root/crypto.node
```

`>>>` 标记表示入口点模块。

**JSON 输出：**

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
      "encoding": "latin1",
      "side": "server",
      "is_entry_point": true
    }
  ]
}
```

你也可以直接传入二进制文件路径（无需子命令）：

```bash
unbun ./myapp
```

### 提取模块

将所有模块提取到某个目录：

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

使用过滤器提取特定模块：

```bash
unbun extract ./myapp ./output -m app.js
unbun extract ./myapp ./output -m 0          # by index
unbun extract ./myapp ./output -m .wasm      # all WASM files
```

过滤器会同时匹配模块索引和模块名称（子串匹配）。

如果未指定输出目录，则默认为 `./extracted`。

### 预览源码

预览某个模块源代码的前 N 行：

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

### 十六进制转储

检查某个模块的原始字节：

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

### 所有命令

| 命令 | 别名 | 说明 |
|---|---|---|
| `unbun list <binary>` | `ls` | 列出所有嵌入式模块 |
| `unbun list <binary> --json` | | 以 JSON 格式列出 |
| `unbun extract <binary> [dir]` | `x` | 提取所有模块 |
| `unbun extract <binary> [dir] -m <filter>` | | 提取匹配的模块 |
| `unbun preview <binary> <filter> [lines]` | `cat` | 预览源码文本 |
| `unbun hexdump <binary> <filter> [bytes]` | `hex` | 内容的十六进制转储 |
| `unbun <binary>` | | `list` 的简写 |
| `unbun --help` | `-h` | 显示帮助 |
| `unbun --version` | `-v` | 显示版本 |

## 库 API

在你自己的工具中以编程方式使用 unbun：

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

### API 参考

#### `parse(filePath: string): ParsedBunBinary`

从文件路径解析 Bun 编译二进制文件。会将整个文件读入内存。

#### `parseBuffer(data: Buffer): ParsedBunBinary`

从 Buffer 解析 Bun 编译二进制文件。当你已经把数据放在内存中时会很有用。

#### `isBunBinary(filePath: string, searchBytes?: number): boolean`

快速检查某个文件是否为 Bun 编译二进制文件，它会扫描文件末尾以查找 trailer，而不是加载整个文件。默认窗口（32 MiB）可覆盖 Linux、Windows 和 macOS 二进制文件。在 macOS 上，trailer 可能位于距文件末尾一兆字节以上的位置，藏在代码签名之后。对于异常大的已签名 macOS 二进制文件，可传入更大的 `searchBytes`。

#### `getModuleSource(parsed, module): string`

以字符串形式获取某个模块的源码内容，按 Bun 标记的编码解码（`latin1`，含非 Latin-1 字符的文本则是 `utf16le`）——与程序在 Bun 下读回该模块时拿到的文本一致。`binary` 模块请改用 `getModuleContents()`。

#### `getModuleContents(parsed, module): Buffer`

以 Buffer 形式获取某个模块的原始源码内容。

#### `getModuleBytecode(parsed, module): Buffer`

获取某个模块的 JSC 字节码。如果没有嵌入字节码，则返回一个空 Buffer。

#### `getModuleSourcemap(parsed, module): Buffer`

获取某个模块的序列化 sourcemap。如果没有嵌入 sourcemap，则返回一个空 Buffer。

#### `findModule(parsed, filter): BunModule | undefined`

查找第一个名称包含 `filter`，或索引匹配 `filter` 的模块。

#### `findModules(parsed, filter): BunModule[]`

查找所有匹配该过滤器的模块。

### 类型

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
  encoding: string;           // "binary" | "latin1" | "utf16le"
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

## 工作原理

Bun 编译二进制文件采用一种源自 Bun 开源代码 [`StandaloneModuleGraph.zig`](https://github.com/oven-sh/bun/blob/main/src/StandaloneModuleGraph.zig) 的明确定义格式。嵌入的 blob 在各平台之间是完全相同的：

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

在 Linux（ELF）上它被追加到文件末尾，而在 macOS（Mach-O）/ Windows（PE）上它被嵌入到某个节（section）中；unbun 通过最后一个 trailer 来定位它。每个模块条目都持有指向 payload 的 `StringPointer`（u32 偏移量 + 长度），分别对应它的名称、内容、sourcemap 和字节码。

随着 Bun 的演进，已经出现过好几种布局。unbun 会按结构（而非版本）自动检测所有这些布局，并在接受某个模块之前校验其每一个指针：

| 布局 | Offsets | 模块条目 | 大致版本 | 值得注意的字段 |
|---|---|---|---|---|
| 最小 | 24 B | 32 B | Bun ~1.0 | name / contents / sourcemap + loader 字节 |
| 紧凑 | 24 B | 36 B | Bun ~1.1 | + `bytecode`、`encoding`/`loader`/`module_format` |
| 中等 | 32 B | 36 B | Bun ~1.2 | + Offsets 的 `compile_exec_argv_ptr` / `flags` |
| 扩展 | 32 B | 52 B | Bun ~1.3+ | + `module_info` / `bytecode_origin_path` / `side` |

## 支持的平台

unbun 支持来自**所有平台**和**所有 Bun 版本**的 Bun 编译二进制文件：

- **Linux**（x64、arm64、x64-musl、arm64-musl）：ELF
- **macOS**（x64、arm64）：Mach-O
- **Windows**（x64、arm64）：PE
- **Bun 版本**：从 1.0 到最新的 canary：每一种模块图布局（参见[工作原理](#工作原理)）都会被自动检测

## 开发

```bash
bun install        # install dependencies
bun run checkall   # type-check + lint + format-check + tests (no writes)
bun run fixall     # auto-fix lint + format
bun test           # run the test suite
bun run build      # compile TypeScript to dist/
```

代码检查（linting）和格式化由 [Biome](https://biomejs.dev/) 负责。测试套件运行在 [`bun test`](https://bun.sh/docs/cli/test) 之上，并会构建自己的合成夹具（fixtures），因此不需要任何外部二进制文件。它还会解析 `test/fixtures/real/` 中一组已提交的微型夹具（来自 Bun 1.0 到 1.3 的真实 `bun build --compile` 输出的截断尾部，每个只有几百字节），作为每种布局的基准（ground truth）。可以用 `scripts/e2e/make-fixtures.mjs` 重新生成它们。

### 对照 Claude Code 发行版进行检查

`bun run check:claude-code` 会下载每个平台上最新的 [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code) 二进制文件，并检查 unbun 能否解析并提取其中每一个。所有内容都会缓存在 `.cache/` 下（已被 gitignore 忽略，约 1.8 GB）。仅供手动运行，不属于 `bun test`、`checkall` 或 CI 的一部分。

### 发布

发布过程由 [vbt](https://www.npmjs.com/package/vbt) 和 GitHub Actions 自动完成。提升版本号会重写 `package.json` 和 CLI 的版本字符串，然后提交、打标签并推送：

```bash
bun run release:patch   # 1.0.0 -> 1.0.1
bun run release:minor   # 1.0.0 -> 1.1.0
bun run release:major   # 1.0.0 -> 2.0.0
```

推送由此产生的 `v*` 标签会触发 **Publish** 工作流，它会重新运行检查，并带着来源证明（provenance）发布到 npm。

## 相关项目

- [cc2js](https://github.com/cc-friend/cc2js)：把任意经 Bun 编译的 Claude Code 转换为纯 Node 构建，从而在普通的 Node v18 及以上版本上运行
- [Bun Standalone Executables docs](https://bun.sh/docs/bundler/executables)：Bun 官方文档

## 许可证

MIT
