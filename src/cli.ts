#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BunModule } from "./parser";
import {
	findModule,
	findModules,
	getModuleBytecode,
	getModuleContents,
	getModuleSourcemap,
	parse,
} from "./parser";

const VERSION = "1.0.0"; // vbt-version

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function cmdList(filePath: string, json: boolean) {
	const parsed = parse(filePath);

	if (json) {
		const output = {
			file: filePath,
			payload_start: parsed.payload_start,
			payload_size: parsed.offsets.byte_count,
			compile_exec_argv: parsed.compile_exec_argv || undefined,
			flags: parsed.flags,
			modules: parsed.modules,
		};
		console.log(JSON.stringify(output, null, 2));
		return;
	}

	console.log(`Bun Compiled Binary: ${filePath}`);
	console.log(
		`Payload offset: ${parsed.payload_start} (${formatSize(parsed.payload_start)})`,
	);
	console.log(
		`Payload size:   ${parsed.offsets.byte_count} (${formatSize(parsed.offsets.byte_count)})`,
	);
	if (parsed.compile_exec_argv) {
		console.log(`Exec argv:      ${parsed.compile_exec_argv}`);
	}
	const activeFlags = Object.entries(parsed.flags)
		.filter(([, v]) => v)
		.map(([k]) => k);
	if (activeFlags.length) {
		console.log(`Flags:          ${activeFlags.join(", ")}`);
	}
	console.log(`Modules:        ${parsed.modules.length}`);
	console.log();

	console.log(
		[
			"#".padStart(3),
			"Entry".padEnd(5),
			"Loader".padEnd(6),
			"Format".padEnd(6),
			"Enc".padEnd(6),
			"Side".padEnd(6),
			"Source".padStart(12),
			"Bytecode".padStart(12),
			"SrcMap".padStart(10),
			"Name",
		].join("  "),
	);
	console.log("-".repeat(130));

	for (const m of parsed.modules) {
		console.log(
			[
				String(m.index).padStart(3),
				(m.is_entry_point ? " >>> " : "     ").padEnd(5),
				m.loader.padEnd(6),
				m.module_format.padEnd(6),
				m.encoding.padEnd(6),
				m.side.padEnd(6),
				formatSize(m.contents_length).padStart(12),
				(m.bytecode_length > 0 ? formatSize(m.bytecode_length) : "-").padStart(
					12,
				),
				(m.sourcemap_length > 0
					? formatSize(m.sourcemap_length)
					: "-"
				).padStart(10),
				m.name,
			].join("  "),
		);
	}
}

function cmdExtract(filePath: string, outDir: string, moduleFilter?: string) {
	const parsed = parse(filePath);

	let toExtract: BunModule[];
	if (moduleFilter) {
		toExtract = findModules(parsed, moduleFilter);
		if (toExtract.length === 0) {
			console.error(`No modules matching "${moduleFilter}"`);
			process.exit(1);
		}
	} else {
		toExtract = parsed.modules;
	}

	for (const m of toExtract) {
		let relativePath = m.name
			.replace(/^\/\$bunfs\/root\//, "")
			.replace(/^\/\$bunfs\//, "")
			// Windows compiled binaries use a `B:/~BUN/root/` virtual root
			.replace(/^[A-Za-z]:[\\/]~BUN[\\/]root[\\/]/, "")
			.replace(/^[A-Za-z]:[\\/]~BUN[\\/]/, "");
		if (!relativePath || relativePath === "/") {
			relativePath = `module_${m.index}`;
		}

		const outputPath = join(outDir, relativePath);
		const outputDirPath = dirname(outputPath);

		if (!existsSync(outputDirPath)) {
			mkdirSync(outputDirPath, { recursive: true });
		}

		// Extract source contents
		const contents = getModuleContents(parsed, m);
		writeFileSync(outputPath, contents);
		console.log(
			`  ${formatSize(m.contents_length).padStart(10)}  ${outputPath}`,
		);

		// Extract bytecode if present
		const bc = getModuleBytecode(parsed, m);
		if (bc.length > 0) {
			const bcPath = `${outputPath}.bytecode`;
			writeFileSync(bcPath, bc);
			console.log(`  ${formatSize(bc.length).padStart(10)}  ${bcPath}`);
		}

		// Extract sourcemap if present
		const sm = getModuleSourcemap(parsed, m);
		if (sm.length > 0) {
			const smPath = `${outputPath}.srcmap`;
			writeFileSync(smPath, sm);
			console.log(`  ${formatSize(sm.length).padStart(10)}  ${smPath}`);
		}
	}

	console.log(`\nExtracted ${toExtract.length} module(s) to ${outDir}`);
}

function cmdPreview(
	filePath: string,
	moduleFilter: string,
	lines: number = 50,
) {
	const parsed = parse(filePath);

	const mod = findModule(parsed, moduleFilter);
	if (!mod) {
		console.error(`No module matching "${moduleFilter}"`);
		process.exit(1);
	}

	const contents = getModuleContents(parsed, mod);
	const text = contents.toString("utf-8");
	const textLines = text.split("\n");
	console.log(
		`Module: ${mod.name} (${formatSize(mod.contents_length)}, ${textLines.length} lines)`,
	);
	console.log("\u2500".repeat(80));
	console.log(textLines.slice(0, lines).join("\n"));
	if (textLines.length > lines) {
		console.log(`\n... (${textLines.length - lines} more lines)`);
	}
}

function cmdHexdump(
	filePath: string,
	moduleFilter: string,
	bytes: number = 512,
) {
	const parsed = parse(filePath);

	const mod = findModule(parsed, moduleFilter);
	if (!mod) {
		console.error(`No module matching "${moduleFilter}"`);
		process.exit(1);
	}

	const contents = getModuleContents(parsed, mod).subarray(0, bytes);
	console.log(`Module: ${mod.name}`);
	console.log(`Size: ${formatSize(mod.contents_length)}`);
	console.log(`First ${contents.length} bytes:\n`);

	for (let i = 0; i < contents.length; i += 16) {
		const row = contents.subarray(i, Math.min(i + 16, contents.length));
		const hex = Array.from(row)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join(" ");
		const ascii = Array.from(row)
			.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
			.join("");
		console.log(
			`  ${(mod.contents_offset + i).toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`,
		);
	}
}

const USAGE = `
unbun v${VERSION} - Bun compiled binary viewer & extractor

Usage:
  unbun <binary>                         List all embedded modules
  unbun list <binary>                    List all embedded modules
  unbun list <binary> --json             List as JSON
  unbun extract <binary> [dir]           Extract all modules (default: ./extracted)
  unbun extract <binary> [dir] -m <filter>  Extract matching modules only
  unbun preview <binary> <filter> [n]    Preview first n lines of source (default: 50)
  unbun hexdump <binary> <filter> [n]    Hex dump first n bytes (default: 512)

Filter:
  A module index number (e.g. "0") or a substring of the module name (e.g. "app.js").

Examples:
  unbun ./myapp
  unbun list ./myapp --json
  unbun extract ./myapp ./out
  unbun extract ./myapp ./out -m app.js
  unbun preview ./myapp app.js
  unbun preview ./myapp 0 100
  unbun hexdump ./myapp resvg.wasm 256
`.trim();

export function main() {
	const args = process.argv.slice(2);

	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		console.log(USAGE);
		process.exit(0);
	}

	if (args.includes("--version") || args[0] === "-v") {
		console.log(VERSION);
		process.exit(0);
	}

	const command = args[0];

	try {
		switch (command) {
			case "list":
			case "ls": {
				const file = args[1];
				if (!file) {
					console.error("Usage: unbun list <binary> [--json]");
					process.exit(1);
				}
				cmdList(file, args.includes("--json"));
				break;
			}

			case "extract":
			case "x": {
				const file = args[1];
				if (!file) {
					console.error("Usage: unbun extract <binary> [dir] [-m <filter>]");
					process.exit(1);
				}
				let outDir = "extracted";
				let filter: string | undefined;
				let i = 2;
				while (i < args.length) {
					if (args[i] === "-m" || args[i] === "--module") {
						filter = args[++i];
					} else if (!args[i].startsWith("-")) {
						outDir = args[i];
					}
					i++;
				}
				cmdExtract(file, outDir, filter);
				break;
			}

			case "preview":
			case "cat": {
				const file = args[1];
				const filter = args[2];
				if (!file || !filter) {
					console.error("Usage: unbun preview <binary> <filter> [lines]");
					process.exit(1);
				}
				const lines = args[3] ? parseInt(args[3], 10) : 50;
				cmdPreview(file, filter, lines);
				break;
			}

			case "hexdump":
			case "hex": {
				const file = args[1];
				const filter = args[2];
				if (!file || !filter) {
					console.error("Usage: unbun hexdump <binary> <filter> [bytes]");
					process.exit(1);
				}
				const bytes = args[3] ? parseInt(args[3], 10) : 512;
				cmdHexdump(file, filter, bytes);
				break;
			}

			default:
				if (existsSync(command)) {
					cmdList(command, args.includes("--json"));
				} else {
					console.error(`Unknown command: ${command}\n`);
					console.log(USAGE);
					process.exit(1);
				}
		}
	} catch (err) {
		console.error(`Error: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}
}

main();
