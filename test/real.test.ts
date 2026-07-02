import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	getModuleSource,
	isBunBinary,
	parse,
	parseBuffer,
} from "../src/parser";

// Tiny truncated tails of real `bun build --compile` output, one per Bun layout.
// See scripts/e2e/make-fixtures.mjs for how they were produced.
const dir = join(import.meta.dir, "fixtures", "real");
const files = readdirSync(dir)
	.filter((f) => f.endsWith(".bin"))
	.sort();

// The module_entry_size each Bun version line emits — the layout fingerprint.
const EXPECTED_ENTRY_SIZE: Record<string, number> = {
	"1.0": 32,
	"1.1": 36,
	"1.2": 36,
	"1.3": 52,
};

function versionOf(file: string): string {
	const m = file.match(/^bun-(\d+\.\d+)-/);
	if (!m) throw new Error(`unexpected fixture name: ${file}`);
	return m[1];
}

describe("real Bun binaries (committed fixtures)", () => {
	test("all four layouts are represented", () => {
		expect(files.length).toBeGreaterThanOrEqual(6);
		const sizes = new Set(files.map((f) => EXPECTED_ENTRY_SIZE[versionOf(f)]));
		expect([...sizes].sort()).toEqual([32, 36, 52]);
	});

	test.each(files)("%s parses, extracts, and matches its layout", (file) => {
		const path = join(dir, file);

		// isBunBinary works on the committed tail directly.
		expect(isBunBinary(path)).toBe(true);

		const parsed = parseBuffer(readFileSync(path));
		expect(parsed.modules.length).toBeGreaterThanOrEqual(1);

		const entry = parsed.modules.find((m) => m.is_entry_point);
		expect(entry).toBeDefined();
		if (!entry) return;
		expect(entry.name.length).toBeGreaterThan(0);

		// Ground-truth layout fingerprint for this Bun version.
		expect(parsed.offsets.module_entry_size).toBe(
			EXPECTED_ENTRY_SIZE[versionOf(file)],
		);

		// Round-trip: the sample's marker string survives extraction.
		expect(getModuleSource(parsed, entry)).toContain("UNBUN_E2E_MARKER");

		// parse() (file path) agrees with parseBuffer().
		expect(parse(path).modules.length).toBe(parsed.modules.length);
	});

	test("the Windows fixture uses the B:/~BUN/ virtual root", () => {
		const win = files.find((f) => f.includes("windows"));
		expect(win).toBeDefined();
		if (!win) return;
		expect(parse(join(dir, win)).modules[0].name).toContain("~BUN");
	});
});
