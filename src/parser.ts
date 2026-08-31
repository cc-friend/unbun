/**
 * Bun compiled binary parser.
 *
 * Parses the embedded module graph from executables created with `bun build --compile`.
 *
 * The embedded blob layout:
 *   [payload data (byte_count bytes)] [Offsets] [trailer (16 bytes)]
 *
 * Several module graph layouts exist across Bun versions (all auto-detected):
 *   Bun ~1.0:   Offsets = 24 bytes, module entry = 32 bytes
 *   Bun ~1.1:   Offsets = 24 bytes, module entry = 36 bytes
 *   Bun ~1.2:   Offsets = 32 bytes, module entry = 36 bytes
 *   Bun ~1.3+:  Offsets = 32 bytes, module entry = 52 bytes
 *
 * How the blob is located differs by platform:
 *   - Linux (ELF): appended to end of file, followed by total_byte_count (u64)
 *   - macOS (Mach-O): embedded in a dedicated section
 *   - Windows (PE): embedded in a dedicated section
 *
 * We locate the blob by searching for the last occurrence of the trailer,
 * then auto-detect the format version.
 *
 * Trailer = "\n---- Bun! ----\n"
 *
 * Based on Bun's open-source standalone module graph (Zig, since ported to Rust):
 *   https://github.com/oven-sh/bun/blob/main/src/standalone_graph/StandaloneModuleGraph.rs
 */

import {
	closeSync,
	fstatSync,
	openSync,
	readFileSync,
	readSync,
} from "node:fs";

// --- Bun binary format constants ---

const TRAILER = Buffer.from("\n---- Bun! ----\n");
const TRAILER_LEN = TRAILER.length; // 16

// StringPointer: { offset: u32, length: u32 } = 8 bytes
const SP_SIZE = 8;

// Module graph layout definitions (auto-detected at parse time).
//
// The layout has grown across Bun releases along two independent axes:
//   - Offsets size: 24 bytes grew to 32 (adds compile_exec_argv_ptr + flags).
//   - Module entry size: 32 -> 36 (adds a bytecode pointer + encoding/loader/
//     module_format) -> 52 (adds module_info, bytecode_origin_path, and side).
//
// Four combinations have shipped (version boundaries are approximate):
//   MINIMAL  (24, 32)  Bun ~1.0  — name/contents/sourcemap + a loader byte only
//   COMPACT  (24, 36)  Bun ~1.1  — adds bytecode pointer + encoding/loader/format
//   MIDSIZE  (32, 36)  Bun ~1.2  — Offsets grows compile_exec_argv_ptr + flags
//   EXTENDED (32, 52)  Bun ~1.3+ — entries add module_info/origin/side
const FORMAT_EXTENDED = { offsetsSize: 32, moduleEntrySize: 52 } as const;
const FORMAT_MIDSIZE = { offsetsSize: 32, moduleEntrySize: 36 } as const;
const FORMAT_COMPACT = { offsetsSize: 24, moduleEntrySize: 36 } as const;
const FORMAT_MINIMAL = { offsetsSize: 24, moduleEntrySize: 32 } as const;
type FormatVersion =
	| typeof FORMAT_MINIMAL
	| typeof FORMAT_COMPACT
	| typeof FORMAT_MIDSIZE
	| typeof FORMAT_EXTENDED;

// --- Enum maps ---

export const LOADERS: Record<number, string> = {
	0: "jsx",
	1: "js",
	2: "ts",
	3: "tsx",
	4: "css",
	5: "file",
	6: "json",
	7: "jsonc",
	8: "toml",
	9: "wasm",
	10: "napi",
	11: "base64",
	12: "dataurl",
	13: "text",
	14: "bunsh",
	15: "sqlite",
	16: "sqlite_embedded",
	17: "html",
	18: "yaml",
	19: "json5",
	20: "md",
};

// How the module's contents were encoded from the JS string Bun held them in.
// Code 2 is UTF-16LE code units, NOT UTF-8: Bun reuses the discriminant of a
// `utf8` variant it never wrote, so that an older runtime reads such a module
// through its plain-copy arm instead of rejecting an unknown value. Names match
// Node's Buffer encodings, so they can be handed straight to `buf.toString()`.
export const ENCODINGS: Record<number, string> = {
	0: "binary",
	1: "latin1",
	2: "utf16le",
};

export const MODULE_FORMATS: Record<number, string> = {
	0: "none",
	1: "esm",
	2: "cjs",
};

export const SIDES: Record<number, string> = {
	0: "server",
	1: "client",
};

// --- Types ---

export interface StringPointer {
	offset: number;
	length: number;
}

export interface Offsets {
	byte_count: number;
	modules_ptr: StringPointer;
	entry_point_id: number;
	compile_exec_argv_ptr: StringPointer;
	flags: number;
	/** Detected module entry size in bytes: 32, 36, or 52 (see format table) */
	module_entry_size: number;
}

export interface RawModuleEntry {
	name: StringPointer;
	contents: StringPointer;
	sourcemap: StringPointer;
	bytecode: StringPointer;
	module_info: StringPointer;
	bytecode_origin_path: StringPointer;
	encoding: number;
	loader: number;
	module_format: number;
	side: number;
}

export interface BunModule {
	/** Index in the modules array */
	index: number;
	/** Virtual path (e.g. /$bunfs/root/src/app.js) */
	name: string;
	/** Offset of source contents within the payload */
	contents_offset: number;
	/** Length of source contents in bytes */
	contents_length: number;
	/** Length of embedded sourcemap in bytes (0 if none) */
	sourcemap_length: number;
	/** Length of embedded bytecode in bytes (0 if none) */
	bytecode_length: number;
	/** Length of module info in bytes (0 if none) */
	module_info_length: number;
	/** Path used when generating bytecode */
	bytecode_origin_path: string;
	/** Content encoding: binary, latin1, or utf16le (see ENCODINGS) */
	encoding: string;
	/** Bun loader type: js, ts, jsx, tsx, css, json, wasm, napi, etc. */
	loader: string;
	/** Module format: none, esm, or cjs */
	module_format: string;
	/** Bundle side: server or client */
	side: string;
	/** Whether this module is the entry point */
	is_entry_point: boolean;
}

export interface CompileFlags {
	disable_default_env_files: boolean;
	disable_autoload_bunfig: boolean;
	disable_autoload_tsconfig: boolean;
	disable_autoload_package_json: boolean;
}

export interface ParsedBunBinary {
	/** Raw Offsets struct values */
	offsets: Offsets;
	/** All embedded modules */
	modules: BunModule[];
	/** The raw payload buffer (all module data) */
	payload: Buffer;
	/** Byte offset where the payload starts in the original file */
	payload_start: number;
	/** Compile-time exec argv string */
	compile_exec_argv: string;
	/** Compile flags */
	flags: CompileFlags;
}

// --- Internal helpers ---

function readSP(buf: Buffer, offset: number): StringPointer {
	return {
		offset: buf.readUInt32LE(offset),
		length: buf.readUInt32LE(offset + 4),
	};
}

function readRawModuleEntryExtended(
	buf: Buffer,
	offset: number,
): RawModuleEntry {
	let pos = offset;
	const name = readSP(buf, pos);
	pos += SP_SIZE;
	const contents = readSP(buf, pos);
	pos += SP_SIZE;
	const sourcemap = readSP(buf, pos);
	pos += SP_SIZE;
	const bytecode = readSP(buf, pos);
	pos += SP_SIZE;
	const module_info = readSP(buf, pos);
	pos += SP_SIZE;
	const bytecode_origin_path = readSP(buf, pos);
	pos += SP_SIZE;
	const encoding = buf.readUInt8(pos);
	pos += 1;
	const loader = buf.readUInt8(pos);
	pos += 1;
	const module_format = buf.readUInt8(pos);
	pos += 1;
	const side = buf.readUInt8(pos);
	return {
		name,
		contents,
		sourcemap,
		bytecode,
		module_info,
		bytecode_origin_path,
		encoding,
		loader,
		module_format,
		side,
	};
}

function readRawModuleEntryCompact(
	buf: Buffer,
	offset: number,
): RawModuleEntry {
	let pos = offset;
	const name = readSP(buf, pos);
	pos += SP_SIZE;
	const contents = readSP(buf, pos);
	pos += SP_SIZE;
	const sourcemap = readSP(buf, pos);
	pos += SP_SIZE;
	const bytecode = readSP(buf, pos);
	pos += SP_SIZE;
	const encoding = buf.readUInt8(pos);
	pos += 1;
	const loader = buf.readUInt8(pos);
	pos += 1;
	const module_format = buf.readUInt8(pos);
	// Compact format (≤1.3.10) lacks module_info, bytecode_origin_path, and side
	return {
		name,
		contents,
		sourcemap,
		bytecode,
		module_info: { offset: 0, length: 0 },
		bytecode_origin_path: { offset: 0, length: 0 },
		encoding,
		loader,
		module_format,
		side: 0,
	};
}

function readRawModuleEntryMinimal(
	buf: Buffer,
	offset: number,
): RawModuleEntry {
	// Bun ~1.0: name, contents, sourcemap (3 StringPointers) + a single loader
	// byte. No bytecode pointer, and no encoding/module_format/side fields.
	let pos = offset;
	const name = readSP(buf, pos);
	pos += SP_SIZE;
	const contents = readSP(buf, pos);
	pos += SP_SIZE;
	const sourcemap = readSP(buf, pos);
	pos += SP_SIZE;
	const loader = buf.readUInt8(pos);
	return {
		name,
		contents,
		sourcemap,
		bytecode: { offset: 0, length: 0 },
		module_info: { offset: 0, length: 0 },
		bytecode_origin_path: { offset: 0, length: 0 },
		encoding: 1, // no per-module encoding field in 1.0; report Bun's default
		loader,
		module_format: 0,
		side: 0,
	};
}

function readRawModuleEntry(
	buf: Buffer,
	offset: number,
	format: FormatVersion,
): RawModuleEntry {
	if (format.moduleEntrySize === 52)
		return readRawModuleEntryExtended(buf, offset);
	if (format.moduleEntrySize === 32)
		return readRawModuleEntryMinimal(buf, offset);
	return readRawModuleEntryCompact(buf, offset);
}

/** Pick the entry reader/stride for a detected module_entry_size. */
function formatFor(moduleEntrySize: number): FormatVersion {
	if (moduleEntrySize === 52) return FORMAT_EXTENDED;
	if (moduleEntrySize === 32) return FORMAT_MINIMAL;
	// 36-byte entries: compact and midsize are read identically.
	return FORMAT_COMPACT;
}

function sliceStr(payload: Buffer, sp: StringPointer): string {
	if (sp.length === 0) return "";
	return payload
		.subarray(sp.offset, sp.offset + sp.length)
		.toString("utf-8")
		.replace(/\0+$/, "");
}

/**
 * Find the last occurrence of the Bun trailer in a buffer.
 * Returns the byte offset of the trailer, or -1 if not found.
 */
function findLastTrailer(data: Buffer): number {
	// Search backwards from the end for efficiency.
	// The trailer is typically near the end of the file.
	for (let i = data.length - TRAILER_LEN; i >= 0; i--) {
		if (data[i] === 0x0a && data.subarray(i, i + TRAILER_LEN).equals(TRAILER)) {
			return i;
		}
	}
	return -1;
}

// --- Public API ---

/**
 * Parse a Bun compiled binary from a file path.
 */
export function parse(filePath: string): ParsedBunBinary {
	const data = readFileSync(filePath);
	return parseBuffer(data);
}

/**
 * Try to read the Offsets struct and validate the format at the given trailer position.
 * Returns null if the format doesn't match.
 */
function tryReadOffsets(
	data: Buffer,
	trailerStart: number,
	format: FormatVersion,
): { offsets: Offsets; payload_start: number } | null {
	const offsetsStart = trailerStart - format.offsetsSize;
	if (offsetsStart < 8) return null;

	const byte_count = Number(data.readBigUInt64LE(offsetsStart));
	if (byte_count <= 0 || byte_count > data.length) return null;

	const modules_ptr = readSP(data, offsetsStart + 8);
	const entry_point_id = data.readUInt32LE(offsetsStart + 16);

	// Extended format (≥1.3.11+) has extra fields; compact doesn't
	const compile_exec_argv_ptr =
		format.offsetsSize === 32
			? readSP(data, offsetsStart + 20)
			: { offset: 0, length: 0 };
	const flags =
		format.offsetsSize === 32 ? data.readUInt32LE(offsetsStart + 28) : 0;

	const payload_start = offsetsStart - byte_count;
	if (payload_start < 0) return null;

	// Validate: modules_ptr must fit within byte_count and divide evenly by module entry size
	if (modules_ptr.offset + modules_ptr.length > byte_count) return null;
	if (modules_ptr.length === 0) return null;
	if (modules_ptr.length % format.moduleEntrySize !== 0) return null;

	const payload = data.subarray(payload_start, payload_start + byte_count);
	const moduleCount = modules_ptr.length / format.moduleEntrySize;
	if (entry_point_id >= moduleCount) return null;

	// Validate every module's name pointer. The name is the first field of each
	// entry, so a wrong offsetsSize/entrySize guess misaligns entries 1..n and
	// yields out-of-range or non-path names. Checking all of them (not just the
	// first) is what disambiguates the three historical layouts.
	try {
		const modulesData = payload.subarray(
			modules_ptr.offset,
			modules_ptr.offset + modules_ptr.length,
		);
		for (let i = 0; i < moduleCount; i++) {
			const base = i * format.moduleEntrySize;
			const name = readSP(modulesData, base);
			if (name.length === 0 || name.length > 4096) return null;
			if (name.offset + name.length > byte_count) return null;
			const s = sliceStr(payload, name);
			if (!s.includes("/") && !s.includes("\\")) return null;
			// The contents pointer (second field) must also stay in-range; this
			// extra constraint makes a wrong entrySize guess essentially
			// impossible to satisfy for every entry.
			const contents = readSP(modulesData, base + SP_SIZE);
			if (contents.offset + contents.length > byte_count) return null;
		}
	} catch {
		return null;
	}

	return {
		offsets: {
			byte_count,
			modules_ptr,
			entry_point_id,
			compile_exec_argv_ptr,
			flags,
			module_entry_size: format.moduleEntrySize,
		},
		payload_start,
	};
}

/**
 * Parse a Bun compiled binary from a Buffer.
 */
export function parseBuffer(data: Buffer): ParsedBunBinary {
	// Find the last occurrence of the trailer in the file.
	// This works for all platforms (ELF, Mach-O, PE) since the internal
	// blob format is identical — only the embedding location differs.
	const trailerStart = findLastTrailer(data);
	if (trailerStart < 0) {
		throw new Error(
			`Trailer not found. Expected "\\n---- Bun! ----\\n". This file is not a Bun compiled binary.`,
		);
	}

	// Auto-detect the layout. Order matters: the all-names validation in
	// tryReadOffsets rejects wrong guesses, so try the richest layout first.
	const result =
		tryReadOffsets(data, trailerStart, FORMAT_EXTENDED) ??
		tryReadOffsets(data, trailerStart, FORMAT_MIDSIZE) ??
		tryReadOffsets(data, trailerStart, FORMAT_COMPACT) ??
		tryReadOffsets(data, trailerStart, FORMAT_MINIMAL);

	if (!result) {
		throw new Error(
			"Failed to parse Offsets struct. Unsupported Bun binary format version.",
		);
	}

	const { offsets, payload_start } = result;
	const format = formatFor(offsets.module_entry_size);
	const payload = data.subarray(
		payload_start,
		payload_start + offsets.byte_count,
	);

	// Parse module entries from the modules list
	const modulesData = payload.subarray(
		offsets.modules_ptr.offset,
		offsets.modules_ptr.offset + offsets.modules_ptr.length,
	);
	const moduleCount = offsets.modules_ptr.length / format.moduleEntrySize;

	const modules: BunModule[] = [];
	for (let i = 0; i < moduleCount; i++) {
		const entry = readRawModuleEntry(
			modulesData,
			i * format.moduleEntrySize,
			format,
		);
		modules.push({
			index: i,
			name: sliceStr(payload, entry.name),
			contents_offset: entry.contents.offset,
			contents_length: entry.contents.length,
			sourcemap_length: entry.sourcemap.length,
			bytecode_length: entry.bytecode.length,
			module_info_length: entry.module_info.length,
			bytecode_origin_path: sliceStr(payload, entry.bytecode_origin_path),
			encoding: ENCODINGS[entry.encoding] ?? `unknown(${entry.encoding})`,
			loader: LOADERS[entry.loader] ?? `unknown(${entry.loader})`,
			module_format:
				MODULE_FORMATS[entry.module_format] ??
				`unknown(${entry.module_format})`,
			side: SIDES[entry.side] ?? `unknown(${entry.side})`,
			is_entry_point: i === offsets.entry_point_id,
		});
	}

	const compile_exec_argv = sliceStr(payload, offsets.compile_exec_argv_ptr);

	const flagBits = offsets.flags;
	const flags: CompileFlags = {
		disable_default_env_files: !!(flagBits & 1),
		disable_autoload_bunfig: !!(flagBits & 2),
		disable_autoload_tsconfig: !!(flagBits & 4),
		disable_autoload_package_json: !!(flagBits & 8),
	};

	return { offsets, modules, payload, payload_start, compile_exec_argv, flags };
}

/**
 * Get the raw source contents of a module as a Buffer.
 */
export function getModuleContents(
	parsed: ParsedBunBinary,
	mod: BunModule,
): Buffer {
	return parsed.payload.subarray(
		mod.contents_offset,
		mod.contents_offset + mod.contents_length,
	);
}

/**
 * Get the source contents of a module as a string, decoded with the encoding
 * Bun tagged it with — the same text Bun itself serves when the program reads
 * the module back out of the virtual filesystem.
 *
 * `binary` modules (native addons, wasm, embedded files) hold no text to decode;
 * use getModuleContents() for those and keep the bytes.
 */
export function getModuleSource(
	parsed: ParsedBunBinary,
	mod: BunModule,
): string {
	const contents = getModuleContents(parsed, mod);
	// The 32-byte (Bun ~1.0) entry carries no encoding field, so parse() reports
	// a default rather than something it read; those graphs store plain source
	// bytes. Only trust the tag on the layouts that actually record one.
	if (parsed.offsets.module_entry_size > 32) {
		if (mod.encoding === "latin1") return contents.toString("latin1");
		if (mod.encoding === "utf16le") return contents.toString("utf16le");
	}
	return contents.toString("utf-8");
}

/**
 * Get the bytecode of a module as a Buffer (empty buffer if no bytecode).
 */
export function getModuleBytecode(
	parsed: ParsedBunBinary,
	mod: BunModule,
): Buffer {
	if (mod.bytecode_length === 0) return Buffer.alloc(0);
	const format = formatFor(parsed.offsets.module_entry_size);
	const modulesData = parsed.payload.subarray(
		parsed.offsets.modules_ptr.offset,
		parsed.offsets.modules_ptr.offset + parsed.offsets.modules_ptr.length,
	);
	const rawEntry = readRawModuleEntry(
		modulesData,
		mod.index * format.moduleEntrySize,
		format,
	);
	if (rawEntry.bytecode.length === 0) return Buffer.alloc(0);
	return parsed.payload.subarray(
		rawEntry.bytecode.offset,
		rawEntry.bytecode.offset + rawEntry.bytecode.length,
	);
}

/**
 * Get the sourcemap of a module as a Buffer (empty buffer if no sourcemap).
 */
export function getModuleSourcemap(
	parsed: ParsedBunBinary,
	mod: BunModule,
): Buffer {
	if (mod.sourcemap_length === 0) return Buffer.alloc(0);
	const format = formatFor(parsed.offsets.module_entry_size);
	const modulesData = parsed.payload.subarray(
		parsed.offsets.modules_ptr.offset,
		parsed.offsets.modules_ptr.offset + parsed.offsets.modules_ptr.length,
	);
	const rawEntry = readRawModuleEntry(
		modulesData,
		mod.index * format.moduleEntrySize,
		format,
	);
	if (rawEntry.sourcemap.length === 0) return Buffer.alloc(0);
	return parsed.payload.subarray(
		rawEntry.sourcemap.offset,
		rawEntry.sourcemap.offset + rawEntry.sourcemap.length,
	);
}

/**
 * Find a module by name substring or index.
 */
export function findModule(
	parsed: ParsedBunBinary,
	filter: string,
): BunModule | undefined {
	return parsed.modules.find(
		(m) => String(m.index) === filter || m.name.includes(filter),
	);
}

/**
 * Find all modules matching a filter.
 */
export function findModules(
	parsed: ParsedBunBinary,
	filter: string,
): BunModule[] {
	return parsed.modules.filter(
		(m) => String(m.index) === filter || m.name.includes(filter),
	);
}

/**
 * Check if a file is a Bun compiled binary (quick check without reading the
 * whole file).
 *
 * Scans the tail of the file for the Bun trailer. The trailer's distance from
 * the end of the file varies by platform: on Linux (ELF) it sits ~8 bytes from
 * the end and on Windows (PE) ~10 KB, but on macOS (Mach-O) it can be well over
 * a megabyte from the end because the code signature and `__LINKEDIT` data
 * follow the embedded blob. The default 32 MiB window comfortably covers all
 * three; pass a larger `searchBytes` for unusually large signed macOS binaries.
 */
export function isBunBinary(
	filePath: string,
	searchBytes = 32 * 1024 * 1024,
): boolean {
	let fd: number | undefined;
	try {
		fd = openSync(filePath, "r");
		const { size } = fstatSync(fd);
		if (size < TRAILER_LEN) return false;

		const searchSize = Math.min(size, searchBytes);
		const buf = Buffer.alloc(searchSize);
		readSync(fd, buf, 0, searchSize, size - searchSize);
		return findLastTrailer(buf) >= 0;
	} catch {
		return false;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
