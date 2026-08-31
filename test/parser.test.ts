import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	findModule,
	findModules,
	getModuleBytecode,
	getModuleContents,
	getModuleSource,
	getModuleSourcemap,
	isBunBinary,
	parse,
	parseBuffer,
} from "../src/parser";
import {
	BUN_TRAILER,
	buildBunBinary,
	type FormatName,
	sampleModules,
} from "./fixtures";

const tmpDirs: string[] = [];

function tmpFile(name: string, data: Buffer): string {
	const dir = mkdtempSync(join(tmpdir(), "unbun-"));
	tmpDirs.push(dir);
	const file = join(dir, name);
	writeFileSync(file, data);
	return file;
}

afterAll(() => {
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe.each<FormatName>([
	"extended",
	"midsize",
	"compact",
])("parseBuffer (%s)", (format) => {
	const parsed = parseBuffer(buildBunBinary(sampleModules(), { format }));

	test("reads every module", () => {
		expect(parsed.modules).toHaveLength(3);
		expect(parsed.modules.map((m) => m.name)).toEqual([
			"/$bunfs/root/src/app.js",
			"/$bunfs/root/config.json",
			"/$bunfs/root/math.wasm",
		]);
	});

	test("decodes enum fields", () => {
		const [app, cfg, wasm] = parsed.modules;
		expect(app.loader).toBe("js");
		expect(app.module_format).toBe("esm");
		expect(app.encoding).toBe("latin1");
		expect(cfg.loader).toBe("json");
		expect(cfg.module_format).toBe("none");
		expect(wasm.loader).toBe("wasm");
		expect(wasm.encoding).toBe("binary");
	});

	test("marks the entry point", () => {
		expect(parsed.modules[0].is_entry_point).toBe(true);
		expect(parsed.modules[1].is_entry_point).toBe(false);
	});

	test("records byte lengths", () => {
		expect(parsed.modules[0].bytecode_length).toBe(8);
		expect(parsed.modules[0].sourcemap_length).toBe(13);
		expect(parsed.modules[1].bytecode_length).toBe(0);
	});

	test("detects the layout version", () => {
		expect(parsed.offsets.module_entry_size).toBe(
			format === "extended" ? 52 : 36,
		);
	});

	test("exposes the payload offset", () => {
		expect(parsed.payload_start).toBe(16);
		expect(parsed.offsets.byte_count).toBe(parsed.payload.length);
	});
});

describe("module content helpers", () => {
	const parsed = parseBuffer(buildBunBinary(sampleModules()));
	const [app, cfg] = parsed.modules;

	test("getModuleContents / getModuleSource", () => {
		expect(getModuleSource(parsed, app)).toBe("// @bun\nconsole.log('hi');\n");
		expect(getModuleContents(parsed, cfg).toString("utf8")).toBe(
			'{"debug":false}',
		);
	});

	test("getModuleBytecode returns bytecode or empty", () => {
		expect([...getModuleBytecode(parsed, app)]).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8,
		]);
		expect(getModuleBytecode(parsed, cfg)).toHaveLength(0);
	});

	test("getModuleSourcemap returns sourcemap or empty", () => {
		expect(getModuleSourcemap(parsed, app).toString("utf8")).toBe(
			'{"version":3}',
		);
		expect(getModuleSourcemap(parsed, cfg)).toHaveLength(0);
	});
});

describe("content encodings", () => {
	// Bun stores a module's contents as the bytes of the JS string it held, tagged
	// with how it encoded them, and decodes them again when the program reads the
	// module back out of the virtual filesystem — getModuleSource must match.
	const parsed = parseBuffer(
		buildBunBinary([
			{ name: "/$bunfs/root/app.js", contents: "export const a = 1;\n" },
			{
				name: "/$bunfs/root/latin1.md",
				contents: Buffer.from("caf\u00e9 na\u00efve", "latin1"),
				encoding: 1,
			},
			{
				name: "/$bunfs/root/utf16.md",
				contents: Buffer.from("caf\u00e9 \u4e2d\u6587 \u{1f680}", "utf16le"),
				encoding: 2,
			},
			{
				name: "/$bunfs/root/addon.node",
				contents: Buffer.from([0x00, 0x80, 0xff, 0x01]),
				encoding: 0,
			},
		]),
	);
	const [app, latin1, utf16, addon] = parsed.modules;

	test("code 2 is utf16le, not utf8", () => {
		expect(app.encoding).toBe("latin1");
		expect(latin1.encoding).toBe("latin1");
		expect(utf16.encoding).toBe("utf16le");
		expect(addon.encoding).toBe("binary");
	});

	test("getModuleSource decodes latin1 contents", () => {
		expect(getModuleSource(parsed, latin1)).toBe("caf\u00e9 na\u00efve");
	});

	test("getModuleSource decodes utf16le contents", () => {
		// what a plain utf-8 decode used to produce: NUL-separated mojibake
		expect(getModuleContents(parsed, utf16).toString("utf-8")).not.toBe(
			"caf\u00e9 \u4e2d\u6587 \u{1f680}",
		);
		expect(getModuleSource(parsed, utf16)).toBe(
			"caf\u00e9 \u4e2d\u6587 \u{1f680}",
		);
	});

	test("getModuleContents stays byte-exact whatever the tag", () => {
		expect([...getModuleContents(parsed, addon)]).toEqual([0, 0x80, 0xff, 1]);
		expect(getModuleContents(parsed, latin1)).toHaveLength(10);
	});
});

describe("minimal (Bun ~1.0) layout", () => {
	const parsed = parseBuffer(
		buildBunBinary(
			[
				{ name: "/$bunfs/root/app.js", contents: 'const s = "caf\u00e9";\n' },
				{ name: "/$bunfs/root/lib.js", contents: "export const b = 2;\n" },
			],
			{ format: "minimal" },
		),
	);

	test("detects the layout and reads every module", () => {
		expect(parsed.offsets.module_entry_size).toBe(32);
		expect(parsed.modules.map((m) => m.name)).toEqual([
			"/$bunfs/root/app.js",
			"/$bunfs/root/lib.js",
		]);
		expect(parsed.modules[0].loader).toBe("js");
		expect(parsed.modules[0].bytecode_length).toBe(0);
	});

	test("getModuleSource keeps UTF-8 where the entry records no encoding", () => {
		// `latin1` here is the default parse() reports, not a tag read from the
		// binary — a 1.0 graph stores plain source bytes, so decoding it as latin1
		// would mangle every non-ASCII character.
		expect(parsed.modules[0].encoding).toBe("latin1");
		expect(getModuleSource(parsed, parsed.modules[0])).toBe(
			'const s = "caf\u00e9";\n',
		);
	});
});

describe("findModule / findModules", () => {
	const parsed = parseBuffer(buildBunBinary(sampleModules()));

	test("finds by name substring", () => {
		expect(findModule(parsed, "config")?.name).toBe("/$bunfs/root/config.json");
	});

	test("finds by index", () => {
		expect(findModule(parsed, "2")?.name).toBe("/$bunfs/root/math.wasm");
	});

	test("returns undefined when nothing matches", () => {
		expect(findModule(parsed, "does-not-exist")).toBeUndefined();
	});

	test("findModules returns all matches", () => {
		expect(findModules(parsed, ".wasm")).toHaveLength(1);
		expect(findModules(parsed, "/$bunfs/root/")).toHaveLength(3);
		expect(findModules(parsed, "nope")).toHaveLength(0);
	});
});

describe("compile flags and exec argv", () => {
	test("parses individual flag bits (extended)", () => {
		// bit 0: default_env_files, bit 2: tsconfig
		const parsed = parseBuffer(
			buildBunBinary(sampleModules(), {
				flags: 0b0101,
				compileExecArgv: "--smol",
			}),
		);
		expect(parsed.flags).toEqual({
			disable_default_env_files: true,
			disable_autoload_bunfig: false,
			disable_autoload_tsconfig: true,
			disable_autoload_package_json: false,
		});
		expect(parsed.compile_exec_argv).toBe("--smol");
	});

	test("midsize layout keeps flags + argv but has no per-module side", () => {
		const parsed = parseBuffer(
			buildBunBinary(sampleModules(), {
				format: "midsize",
				flags: 0b1000,
				compileExecArgv: "--foo",
			}),
		);
		expect(parsed.flags.disable_autoload_package_json).toBe(true);
		expect(parsed.compile_exec_argv).toBe("--foo");
		// 36-byte entries carry no side or module_info fields
		expect(parsed.modules[2].side).toBe("server");
		expect(parsed.modules[0].module_info_length).toBe(0);
		expect(parsed.offsets.module_entry_size).toBe(36);
	});

	test("compact layout has no flags, side, or exec argv", () => {
		const parsed = parseBuffer(
			buildBunBinary(sampleModules(), { format: "compact" }),
		);
		expect(Object.values(parsed.flags).every((v) => v === false)).toBe(true);
		expect(parsed.compile_exec_argv).toBe("");
		// math.wasm was built as client, but compact has no side field
		expect(parsed.modules[2].side).toBe("server");
	});
});

describe("edge cases", () => {
	test("unknown enum codes fall back to unknown(N)", () => {
		const parsed = parseBuffer(
			buildBunBinary([
				{ name: "/$bunfs/root/x", contents: "x", loader: 99, encoding: 42 },
			]),
		);
		expect(parsed.modules[0].loader).toBe("unknown(99)");
		expect(parsed.modules[0].encoding).toBe("unknown(42)");
	});

	test("trailing NUL bytes are trimmed from names", () => {
		const parsed = parseBuffer(
			buildBunBinary([{ name: "/$bunfs/root/x.js\0\0", contents: "x" }]),
		);
		expect(parsed.modules[0].name).toBe("/$bunfs/root/x.js");
	});

	test("uses the last trailer when several are present", () => {
		const real = buildBunBinary(sampleModules());
		const decoy = Buffer.concat([
			Buffer.alloc(40),
			BUN_TRAILER,
			Buffer.alloc(40),
		]);
		expect(parseBuffer(Buffer.concat([decoy, real])).modules).toHaveLength(3);
	});

	test("disambiguates midsize (32,36) from extended (32,52) when counts align", () => {
		// 13 * 36 == 9 * 52 == 468, so entry size is ambiguous by length alone.
		const mods = Array.from({ length: 13 }, (_, i) => ({
			name: `/$bunfs/root/m${i}.js`,
			contents: `x${i}`,
		}));
		const parsed = parseBuffer(buildBunBinary(mods, { format: "midsize" }));
		expect(parsed.offsets.module_entry_size).toBe(36);
		expect(parsed.modules).toHaveLength(13);
		expect(parsed.modules[12].name).toBe("/$bunfs/root/m12.js");
	});

	test("throws when there is no trailer", () => {
		expect(() =>
			parseBuffer(Buffer.from("definitely not a bun binary")),
		).toThrow(/not a Bun compiled binary/);
	});

	test("throws when the offsets struct is invalid", () => {
		const bogus = Buffer.concat([Buffer.alloc(128), BUN_TRAILER]);
		expect(() => parseBuffer(bogus)).toThrow(/Failed to parse Offsets/);
	});
});

describe("parse and isBunBinary (file-based)", () => {
	test("parse() reads a binary from disk", () => {
		const file = tmpFile("app", buildBunBinary(sampleModules()));
		expect(parse(file).modules).toHaveLength(3);
	});

	test("isBunBinary is true even when the trailer is far from the end", () => {
		// macOS-style: trailer sits ~1 MB before EOF, past the old 64 KB window.
		const file = tmpFile(
			"mac",
			buildBunBinary(sampleModules(), { trailingSize: 1_000_000 }),
		);
		expect(isBunBinary(file)).toBe(true);
	});

	test("isBunBinary respects a narrow search window", () => {
		const file = tmpFile(
			"mac",
			buildBunBinary(sampleModules(), { trailingSize: 1_000_000 }),
		);
		expect(isBunBinary(file, 1024)).toBe(false);
	});

	test("isBunBinary is false for non-Bun, tiny, and missing files", () => {
		expect(isBunBinary(tmpFile("plain", Buffer.alloc(100_000, 7)))).toBe(false);
		expect(isBunBinary(tmpFile("tiny", Buffer.from("hi")))).toBe(false);
		expect(isBunBinary(join(tmpdir(), "unbun-does-not-exist-xyz"))).toBe(false);
	});

	test("parse() throws on a non-Bun file", () => {
		const file = tmpFile("plain", Buffer.alloc(100_000, 7));
		expect(() => parse(file)).toThrow();
	});
});
