/**
 * Synthetic Bun compiled-binary builder for tests.
 *
 * Produces in-memory buffers that match the on-disk layout the parser expects:
 *
 *   [prefix] [payload (byte_count)] [Offsets] [trailer (16)] [trailing]
 *
 * This lets us exercise the real parser without shipping the ~200 MB platform
 * binaries. Every module graph layout the parser auto-detects is supported, from
 * the minimal Bun ~1.0 entry to the extended Bun >=1.3.11 one.
 */

export const BUN_TRAILER = Buffer.from("\n---- Bun! ----\n");

const SP_SIZE = 8;

export const FORMATS = {
	minimal: { offsetsSize: 24, moduleEntrySize: 32 }, // Bun ~1.0
	compact: { offsetsSize: 24, moduleEntrySize: 36 }, // Bun ~1.0–1.1
	midsize: { offsetsSize: 32, moduleEntrySize: 36 }, // Bun ~1.2
	extended: { offsetsSize: 32, moduleEntrySize: 52 }, // Bun ~1.3.10+
} as const;

export type FormatName = keyof typeof FORMATS;

export interface FixtureModule {
	name: string;
	contents: Buffer | string;
	bytecode?: Buffer;
	sourcemap?: Buffer;
	/** extended layout only */
	moduleInfo?: Buffer;
	/** extended layout only */
	bytecodeOriginPath?: string;
	/** encoding code: 0 binary, 1 latin1 (default, as in Bun), 2 utf16le */
	encoding?: number;
	/** loader code: 1 js (default), 6 json, 9 wasm, 10 napi, ... */
	loader?: number;
	/** module format code: 0 none, 1 esm (default), 2 cjs */
	moduleFormat?: number;
	/** side code: 0 server (default), 1 client */
	side?: number;
}

export interface FixtureOptions {
	format?: FormatName;
	entryPoint?: number;
	/** extended layout only */
	flags?: number;
	/** extended layout only */
	compileExecArgv?: string;
	/** bytes before the payload (simulates the host executable) */
	prefixSize?: number;
	/** bytes after the trailer (simulates macOS __LINKEDIT / Linux u64 tail) */
	trailingSize?: number;
}

interface StringPointer {
	offset: number;
	length: number;
}

function toBuf(v: Buffer | string): Buffer {
	return typeof v === "string" ? Buffer.from(v, "utf8") : v;
}

function writeSP(buf: Buffer, off: number, sp: StringPointer): void {
	buf.writeUInt32LE(sp.offset, off);
	buf.writeUInt32LE(sp.length, off + 4);
}

/** Build a synthetic Bun compiled binary from a module list. */
export function buildBunBinary(
	modules: FixtureModule[],
	opts: FixtureOptions = {},
): Buffer {
	const format = FORMATS[opts.format ?? "extended"];
	const hasArgvFlags = format.offsetsSize === 32;
	const hasEntryExtras = format.moduleEntrySize === 52;
	// Bun ~1.0 entries stop after three pointers and a loader byte: no bytecode
	// pointer, and no encoding/module_format/side.
	const hasBytecodePtr = format.moduleEntrySize > 32;
	const entryPoint = opts.entryPoint ?? 0;
	const prefixSize = opts.prefixSize ?? 16;
	const trailingSize = opts.trailingSize ?? 0;

	// --- Data region: names, contents, maps, bytecode, argv ---
	const chunks: Buffer[] = [];
	let cursor = 0;
	const put = (buf: Buffer): StringPointer => {
		if (buf.length === 0) return { offset: 0, length: 0 };
		const offset = cursor;
		chunks.push(buf);
		cursor += buf.length;
		return { offset, length: buf.length };
	};

	const entries = modules.map((m) => ({
		name: put(toBuf(m.name)),
		contents: put(toBuf(m.contents)),
		sourcemap: put(m.sourcemap ?? Buffer.alloc(0)),
		bytecode: put(m.bytecode ?? Buffer.alloc(0)),
		moduleInfo: put(m.moduleInfo ?? Buffer.alloc(0)),
		bytecodeOriginPath: put(toBuf(m.bytecodeOriginPath ?? "")),
		encoding: m.encoding ?? 1,
		loader: m.loader ?? 1,
		moduleFormat: m.moduleFormat ?? 1,
		side: m.side ?? 0,
	}));

	const execArgv = hasArgvFlags
		? put(toBuf(opts.compileExecArgv ?? ""))
		: { offset: 0, length: 0 };

	// --- Module table (lives inside the payload) ---
	const tableOffset = cursor;
	const tableLength = modules.length * format.moduleEntrySize;
	const table = Buffer.alloc(tableLength);
	entries.forEach((e, i) => {
		let p = i * format.moduleEntrySize;
		writeSP(table, p, e.name);
		p += SP_SIZE;
		writeSP(table, p, e.contents);
		p += SP_SIZE;
		writeSP(table, p, e.sourcemap);
		p += SP_SIZE;
		if (!hasBytecodePtr) {
			table.writeUInt8(e.loader, p);
			return;
		}
		writeSP(table, p, e.bytecode);
		p += SP_SIZE;
		if (hasEntryExtras) {
			writeSP(table, p, e.moduleInfo);
			p += SP_SIZE;
			writeSP(table, p, e.bytecodeOriginPath);
			p += SP_SIZE;
		}
		table.writeUInt8(e.encoding, p);
		p += 1;
		table.writeUInt8(e.loader, p);
		p += 1;
		table.writeUInt8(e.moduleFormat, p);
		p += 1;
		if (hasEntryExtras) {
			table.writeUInt8(e.side, p);
		}
	});
	chunks.push(table);
	cursor += tableLength;

	// Tail padding so a compact payload never mis-detects as extended: the
	// extended probe reads these zero bytes as byte_count = 0 and bails.
	chunks.push(Buffer.alloc(16));
	cursor += 16;

	const payload = Buffer.concat(chunks);
	const byteCount = payload.length;

	// --- Offsets struct ---
	const offsets = Buffer.alloc(format.offsetsSize);
	offsets.writeBigUInt64LE(BigInt(byteCount), 0);
	writeSP(offsets, 8, { offset: tableOffset, length: tableLength });
	offsets.writeUInt32LE(entryPoint, 16);
	if (hasArgvFlags) {
		writeSP(offsets, 20, execArgv);
		offsets.writeUInt32LE(opts.flags ?? 0, 28);
	}

	return Buffer.concat([
		Buffer.alloc(prefixSize),
		payload,
		offsets,
		BUN_TRAILER,
		Buffer.alloc(trailingSize),
	]);
}

/** A small, representative multi-module fixture used across tests. */
export function sampleModules(): FixtureModule[] {
	return [
		{
			name: "/$bunfs/root/src/app.js",
			contents: "// @bun\nconsole.log('hi');\n",
			bytecode: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
			sourcemap: Buffer.from('{"version":3}', "utf8"),
			loader: 1,
			moduleFormat: 1,
			side: 0,
		},
		{
			name: "/$bunfs/root/config.json",
			contents: '{"debug":false}',
			loader: 6,
			moduleFormat: 0,
		},
		{
			name: "/$bunfs/root/math.wasm",
			contents: Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
			loader: 9,
			moduleFormat: 0,
			encoding: 0,
			side: 1,
		},
	];
}
