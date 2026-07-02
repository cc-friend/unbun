import { beforeAll, describe, expect, test } from "bun:test";
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBunBinary, sampleModules } from "./fixtures";

// The published artifact is `dist/cli.js` run by Node (shebang `#!/usr/bin/env
// node`), so these tests build it and drive it through the real `node` binary —
// which also proves the CLI works outside Bun.
const root = join(import.meta.dir, "..");
const cli = join(root, "dist", "cli.js");

let dir: string;
let fixture: string;

function runNode(...args: string[]): SpawnSyncReturns<string> {
	return spawnSync("node", [cli, ...args], { cwd: root, encoding: "utf8" });
}

beforeAll(() => {
	const build = spawnSync(process.execPath, ["run", "build"], {
		cwd: root,
		encoding: "utf8",
	});
	if (build.status !== 0) {
		throw new Error(`build failed:\n${build.stdout}\n${build.stderr}`);
	}
	dir = mkdtempSync(join(tmpdir(), "unbun-cli-"));
	fixture = join(dir, "app");
	writeFileSync(fixture, buildBunBinary(sampleModules()));
});

describe("list", () => {
	test("--json emits structured output", () => {
		const r = runNode("list", fixture, "--json");
		expect(r.status).toBe(0);
		const out = JSON.parse(r.stdout);
		expect(out.modules).toHaveLength(3);
		expect(out.modules[0].name).toBe("/$bunfs/root/src/app.js");
		expect(out.modules[0].is_entry_point).toBe(true);
	});

	test("a bare path is a shorthand for list", () => {
		const r = runNode(fixture);
		expect(r.status).toBe(0);
		expect(r.stdout).toContain("Bun Compiled Binary");
		expect(r.stdout).toContain("/$bunfs/root/config.json");
	});
});

describe("extract", () => {
	test("writes every module, stripping the /$bunfs/root/ prefix", () => {
		const out = join(dir, "out-all");
		const r = runNode("extract", fixture, out);
		expect(r.status).toBe(0);
		expect(existsSync(join(out, "src/app.js"))).toBe(true);
		expect(existsSync(join(out, "src/app.js.bytecode"))).toBe(true);
		expect(existsSync(join(out, "config.json"))).toBe(true);
		expect(existsSync(join(out, "math.wasm"))).toBe(true);
	});

	test("-m filters to matching modules", () => {
		const out = join(dir, "out-wasm");
		const r = runNode("extract", fixture, out, "-m", ".wasm");
		expect(r.status).toBe(0);
		expect(existsSync(join(out, "math.wasm"))).toBe(true);
		expect(existsSync(join(out, "config.json"))).toBe(false);
	});

	test("strips the Windows B:/~BUN/root/ virtual prefix", () => {
		const winBin = join(dir, "winapp");
		writeFileSync(
			winBin,
			buildBunBinary([
				{ name: "B:/~BUN/root/win/app.js", contents: "// win\n" },
			]),
		);
		const out = join(dir, "out-win");
		const r = runNode("extract", winBin, out);
		expect(r.status).toBe(0);
		expect(existsSync(join(out, "win/app.js"))).toBe(true);
	});
});

describe("preview and hexdump", () => {
	test("preview prints source text", () => {
		const r = runNode("preview", fixture, "app.js");
		expect(r.status).toBe(0);
		expect(r.stdout).toContain("Module: /$bunfs/root/src/app.js");
		expect(r.stdout).toContain("console.log('hi')");
	});

	test("hexdump prints raw bytes", () => {
		const r = runNode("hexdump", fixture, "math.wasm", "8");
		expect(r.status).toBe(0);
		expect(r.stdout).toContain("00 61 73 6d");
	});
});

describe("meta and errors", () => {
	test("--version matches package.json", () => {
		const r = runNode("--version");
		expect(r.status).toBe(0);
		const { version } = JSON.parse(
			readFileSync(join(root, "package.json"), "utf8"),
		);
		expect(r.stdout.trim()).toBe(version);
	});

	test("--help prints usage", () => {
		const r = runNode("--help");
		expect(r.status).toBe(0);
		expect(r.stdout).toContain("unbun");
		expect(r.stdout).toContain("Usage:");
	});

	test("a non-Bun file exits 1 with a clear error", () => {
		const bad = join(dir, "bad");
		writeFileSync(bad, Buffer.alloc(2000, 9));
		const r = runNode("list", bad);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("not a Bun compiled binary");
	});

	test("a missing argument exits 1", () => {
		expect(runNode("list").status).toBe(1);
	});
});
