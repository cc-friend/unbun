// Truncate a Bun compiled binary down to just its embedded blob
// ([payload][offsets][trailer]) so it can be committed as a tiny (~300 B) real
// fixture. unbun only reads the tail of the file, so the truncated blob parses
// identically to the original multi-hundred-MB executable.
//
//   node scripts/e2e/make-fixtures.mjs <compiled-binary> <fixture-name>
//
// writes test/fixtures/real/<fixture-name>.bin
//
// The committed fixtures were produced from scripts/e2e/sample.ts compiled with:
//   bun 1.0.36  (native)                 -> bun-1.0-linux-x64
//   bun 1.1.45  (native)                 -> bun-1.1-linux-x64
//   bun 1.2.23  (native)                 -> bun-1.2-linux-x64
//   bun 1.3.x   (native / --target=...)  -> bun-1.3-{linux-x64,windows-x64,darwin-arm64}

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { parse } = require(join(repo, "dist", "index.js"));

const [src, name] = process.argv.slice(2);
if (!src || !name) {
	console.error("usage: make-fixtures.mjs <compiled-binary> <fixture-name>");
	process.exit(1);
}

const TRAILER = Buffer.from("\n---- Bun! ----\n");
const data = readFileSync(src);
const parsed = parse(src); // validates the binary and gives payload_start
const trailerEnd = data.lastIndexOf(TRAILER) + TRAILER.length;
const tail = data.subarray(parsed.payload_start, trailerEnd);

const outDir = join(repo, "test", "fixtures", "real");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${name}.bin`), tail);

const mb = (data.length / 1024 / 1024).toFixed(0);
console.log(
	`${name}.bin  ${tail.length} B  (from ${mb} MB, ${parsed.offsets.module_entry_size}-byte entries)`,
);
