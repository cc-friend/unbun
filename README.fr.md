# unbun

[![npm version](https://img.shields.io/npm/v/unbunjs.svg)](https://www.npmjs.com/package/unbunjs) [![CI](https://github.com/cc-friend/unbun/actions/workflows/ci.yml/badge.svg)](https://github.com/cc-friend/unbun/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/npm/l/unbunjs.svg)](./LICENSE)

[English](README.md) | [中文](README.zh.md) | **Français**

Inspectez et extrayez les modules embarqués des [binaires compilés par Bun](https://bun.sh/docs/bundler/executables) (`bun build --compile`).

Lorsque vous compilez un projet JavaScript/TypeScript avec `bun build --compile`, Bun regroupe votre code source, le bytecode, les fichiers WASM, les modules natifs et d'autres ressources dans un unique exécutable autonome. **unbun** vous permet d'inspecter l'intérieur de ces binaires, de lister tous les modules embarqués, de prévisualiser leur contenu et de les extraire sur le disque.

[CC2Node](https://github.com/cc-friend/cc2node) est un outil CLI basé sur unbun, il peut convertir n'importe quel Claude Code compilé avec Bun en une version pure Node qui fonctionne sur un simple Node v18 ou ultérieur.

## Installation

```bash
# Global install (recommended for CLI usage)
npm i -g unbunjs   # or: bun i -g unbunjs

# Local install (for library usage)
npm i unbunjs      # or: bun i unbunjs
```

Ou exécutez-le directement avec npx :

```bash
npx unbunjs ./my-compiled-app  # or: bunx unbunjs ./my-compiled-app
```

## Utilisation de la CLI

### Lister les modules

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

Le marqueur `>>>` indique le module servant de point d'entrée.

**Sortie JSON :**

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

Vous pouvez aussi simplement passer directement le chemin du binaire (sans sous-commande) :

```bash
unbun ./myapp
```

### Extraire les modules

Extraire tous les modules vers un répertoire :

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

Extraire des modules spécifiques à l'aide d'un filtre :

```bash
unbun extract ./myapp ./output -m app.js
unbun extract ./myapp ./output -m 0          # by index
unbun extract ./myapp ./output -m .wasm      # all WASM files
```

Le filtre est comparé à la fois à l'index et au nom du module (correspondance de sous-chaîne).

Si aucun répertoire de sortie n'est spécifié, la valeur par défaut est `./extracted`.

### Prévisualiser le code source

Prévisualisez les N premières lignes du code source d'un module :

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

### Vidage hexadécimal

Inspectez les octets bruts d'un module :

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

### Toutes les commandes

| Commande | Alias | Description |
|---|---|---|
| `unbun list <binary>` | `ls` | Lister tous les modules embarqués |
| `unbun list <binary> --json` | | Lister au format JSON |
| `unbun extract <binary> [dir]` | `x` | Extraire tous les modules |
| `unbun extract <binary> [dir] -m <filter>` | | Extraire les modules correspondants |
| `unbun preview <binary> <filter> [lines]` | `cat` | Prévisualiser le texte source |
| `unbun hexdump <binary> <filter> [bytes]` | `hex` | Vidage hexadécimal du contenu |
| `unbun <binary>` | | Raccourci pour `list` |
| `unbun --help` | `-h` | Afficher l'aide |
| `unbun --version` | `-v` | Afficher la version |

## API de la bibliothèque

Utilisez unbun par programmation dans vos propres outils :

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

### Référence de l'API

#### `parse(filePath: string): ParsedBunBinary`

Analyse un binaire compilé Bun à partir d'un chemin de fichier. Lit l'intégralité du fichier en mémoire.

#### `parseBuffer(data: Buffer): ParsedBunBinary`

Analyse un binaire compilé Bun à partir d'un Buffer. Utile lorsque vous avez déjà les données en mémoire.

#### `isBunBinary(filePath: string, searchBytes?: number): boolean`

Vérifie rapidement si un fichier est un binaire compilé Bun, en analysant la fin du fichier à la recherche du trailer plutôt que de charger l'ensemble. La fenêtre par défaut (32 MiB) couvre les binaires Linux, Windows et macOS. Sur macOS, le trailer peut se trouver à plus d'un mégaoctet de la fin, derrière la signature de code. Passez une valeur `searchBytes` plus grande pour les binaires macOS signés exceptionnellement volumineux.

#### `getModuleSource(parsed, module): string`

Récupère le contenu source d'un module sous forme de chaîne UTF-8.

#### `getModuleContents(parsed, module): Buffer`

Récupère le contenu source brut d'un module sous forme de Buffer.

#### `getModuleBytecode(parsed, module): Buffer`

Récupère le bytecode JSC d'un module. Renvoie un Buffer vide si aucun bytecode n'est embarqué.

#### `getModuleSourcemap(parsed, module): Buffer`

Récupère le sourcemap sérialisé d'un module. Renvoie un Buffer vide si aucun sourcemap n'est embarqué.

#### `findModule(parsed, filter): BunModule | undefined`

Recherche le premier module dont le nom contient `filter`, ou dont l'index correspond à `filter`.

#### `findModules(parsed, filter): BunModule[]`

Recherche tous les modules correspondant au filtre.

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

## Fonctionnement

Les binaires compilés Bun utilisent un format bien défini issu du fichier open source [`StandaloneModuleGraph.zig`](https://github.com/oven-sh/bun/blob/main/src/StandaloneModuleGraph.zig) de Bun. Le blob embarqué est identique sur toutes les plateformes :

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

Il est ajouté à la fin du fichier sur Linux (ELF) et embarqué dans une section sur macOS (Mach-O) / Windows (PE) ; unbun le retrouve grâce au dernier trailer. Chaque entrée de module contient des `StringPointer` (décalage u32 + longueur) pointant dans la charge utile pour son nom, son contenu, son sourcemap et son bytecode.

Plusieurs dispositions se sont succédé au fil de l'évolution de Bun. unbun les détecte toutes automatiquement d'après leur structure (et non leur version), en validant les pointeurs de chaque module avant d'en accepter un :

| Disposition | Offsets | Entrée de module | Environ | Champs notables |
|---|---|---|---|---|
| Minimal | 24 B | 32 B | Bun ~1.0 | name / contents / sourcemap + octet loader |
| Compact | 24 B | 36 B | Bun ~1.1 | + `bytecode`, `encoding`/`loader`/`module_format` |
| Intermédiaire | 32 B | 36 B | Bun ~1.2 | + Offsets `compile_exec_argv_ptr` / `flags` |
| Étendu | 32 B | 52 B | Bun ~1.3+ | + `module_info` / `bytecode_origin_path` / `side` |

## Plateformes prises en charge

unbun prend en charge les binaires compilés Bun de **toutes les plateformes** et de **toutes les versions de Bun** :

- **Linux** (x64, arm64, x64-musl, arm64-musl) : ELF
- **macOS** (x64, arm64) : Mach-O
- **Windows** (x64, arm64) : PE
- **Versions de Bun** : de la 1.0 jusqu'à la dernière version canary : chaque disposition du graphe de modules (voir [Fonctionnement](#fonctionnement)) est détectée automatiquement

## Développement

```bash
bun install        # install dependencies
bun run checkall   # type-check + lint + format-check + tests (no writes)
bun run fixall     # auto-fix lint + format
bun test           # run the test suite
bun run build      # compile TypeScript to dist/
```

Le linting et le formatage sont gérés par [Biome](https://biomejs.dev/). La suite de tests s'exécute avec [`bun test`](https://bun.sh/docs/cli/test) et construit ses propres fixtures synthétiques, elle n'a donc besoin d'aucun binaire externe. Elle analyse également un ensemble de minuscules fixtures versionnées dans `test/fixtures/real/` (des fins tronquées de véritables sorties de `bun build --compile` de Bun 1.0 à 1.3, quelques centaines d'octets chacune) comme référence pour chaque disposition. Régénérez-les avec `scripts/e2e/make-fixtures.mjs`.

### Vérification par rapport aux versions de Claude Code

`bun run check:claude-code` télécharge les derniers binaires de [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code) pour chaque plateforme et vérifie qu'unbun analyse et extrait chacun d'eux. Tout est mis en cache dans `.cache/` (ignoré par git, ~1.8 GB). Manuel uniquement et ne fait pas partie de `bun test`, `checkall` ni de la CI.

### Publication des versions

Les publications sont automatisées avec [vbt](https://www.npmjs.com/package/vbt) et GitHub
Actions. L'incrémentation de la version réécrit `package.json` et la chaîne de version
de la CLI, puis effectue un commit, un tag et un push :

```bash
bun run release:patch   # 1.0.0 -> 1.0.1
bun run release:minor   # 1.0.0 -> 1.1.0
bun run release:major   # 1.0.0 -> 2.0.0
```

Le push du tag `v*` résultant déclenche le workflow **Publish**, qui
relance les vérifications et publie sur npm avec provenance. Il nécessite un
secret de dépôt `NPM_TOKEN` (un token d'automatisation npm).

## Projets connexes

- [CC2Node](https://github.com/cc-friend/cc2node) : Convertir n'importe quel Claude Code compilé avec Bun en une version pure Node qui fonctionne sur un simple Node v18 ou ultérieur
- [Documentation des exécutables autonomes Bun](https://bun.sh/docs/bundler/executables) : Documentation officielle de Bun

## Licence

MIT
