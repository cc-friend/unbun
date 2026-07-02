// Download the latest Claude Code compiled binaries for every platform and
// verify that unbun can parse AND extract each one.
//
// This is a manual, on-demand smoke test against real-world binaries. It is
// deliberately NOT wired into `bun test`, `bun run checkall`, or CI — it pulls
// ~1.8 GB over the network. Run it yourself when you want to confirm unbun keeps
// up with the latest Claude Code release:
//
//   bun run check:claude-code
//   node scripts/check-claude-code.mjs --version 2.1.187
//   node scripts/check-claude-code.mjs --platforms linux-x64,darwin-arm64
//
// Everything lives under .cache/ (gitignored): each binary is downloaded to
// .cache/claude-code-<version>/<platform>/ (checksum-verified, so re-runs skip
// the download) and unbun extracts it alongside into .../extracted/, which is
// cleared and rewritten on every run.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "dist", "cli.js");
const BASE =
	"https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases";

const args = process.argv.slice(2);
const flag = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const only = flag("--platforms")
	?.split(",")
	.map((s) => s.trim());

const mb = (n) => `${(n / 1024 / 1024).toFixed(0)} MB`;

async function fetchOk(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
	return res;
}

async function download(url, dest, expectedSha) {
	mkdirSync(dirname(dest), { recursive: true });
	const res = await fetchOk(url);
	const hash = createHash("sha256");
	let seen = 0;
	let dots = 0;
	const tap = new Transform({
		transform(chunk, _enc, cb) {
			hash.update(chunk);
			seen += chunk.length;
			while (seen - dots * 20 * 1024 * 1024 >= 20 * 1024 * 1024) {
				process.stdout.write(".");
				dots++;
			}
			cb(null, chunk);
		},
	});
	await pipeline(Readable.fromWeb(res.body), tap, createWriteStream(dest));
	const got = hash.digest("hex");
	if (got !== expectedSha) {
		throw new Error(`checksum mismatch (got ${got.slice(0, 12)}…)`);
	}
}

const unbun = (...a) =>
	spawnSync(process.execPath, [CLI, ...a], {
		encoding: "utf8",
		maxBuffer: 128 * 1024 * 1024,
	});

function walk(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else out.push(p);
	}
	return out;
}

// Parse a binary and extract it into `out`, asserting the round-trip.
function verify(bin, out) {
	const listed = unbun("list", bin, "--json");
	if (listed.status !== 0) {
		throw new Error(`unbun list failed: ${(listed.stderr || "").trim()}`);
	}
	const meta = JSON.parse(listed.stdout);
	const entry = meta.modules.find((m) => m.is_entry_point) ?? meta.modules[0];
	if (!entry) throw new Error("no modules parsed");

	rmSync(out, { recursive: true, force: true }); // clear any stale extraction
	const ex = unbun("extract", bin, out);
	if (ex.status !== 0) {
		throw new Error(`unbun extract failed: ${(ex.stderr || "").trim()}`);
	}
	const files = walk(out);
	const entryExtracted = files.some(
		(f) => statSync(f).size === entry.contents_length,
	);
	if (files.length < meta.modules.length || !entryExtracted) {
		throw new Error(
			`extract incomplete (${files.length} files, entry ${entryExtracted ? "ok" : "missing"})`,
		);
	}
	return { modules: meta.modules.length, files: files.length };
}

// ---- main ----
if (!existsSync(CLI)) {
	console.error(`unbun is not built (${CLI}). Run \`bun run build\` first.`);
	process.exit(1);
}

let version = flag("--version");
if (!version) {
	process.stdout.write("Resolving latest stable version… ");
	version = (await fetchOk(`${BASE}/stable`).then((r) => r.text())).trim();
	console.log(version);
}

const manifest = await fetchOk(`${BASE}/${version}/manifest.json`).then((r) =>
	r.json(),
);
let platforms = Object.entries(manifest.platforms);
if (only) platforms = platforms.filter(([p]) => only.includes(p));
if (platforms.length === 0) {
	console.error("no matching platforms");
	process.exit(1);
}

const cacheDir = join(REPO, ".cache", `claude-code-${version}`);
const total = platforms.reduce((s, [, i]) => s + i.size, 0);
console.log(
	`\nClaude Code ${version} — testing unbun against ${platforms.length} platform binaries (${mb(total)})`,
);
console.log(`cache: ${cacheDir}  (binaries + extracted/ per platform)\n`);

const results = [];
for (const [platform, info] of platforms) {
	const dest = join(cacheDir, platform, info.binary);
	const extractDir = join(cacheDir, platform, "extracted");
	const cached =
		existsSync(dest) &&
		statSync(dest).size === info.size &&
		createHash("sha256").update(readFileSync(dest)).digest("hex") ===
			info.checksum;
	try {
		if (cached) {
			process.stdout.write(`  ${platform.padEnd(18)} cached `);
		} else {
			process.stdout.write(`  ${platform.padEnd(18)} ↓ ${mb(info.size)} `);
			await download(`${BASE}/${version}/${platform}/${info.binary}`, dest, info.checksum);
		}
		const { modules, files } = verify(dest, extractDir);
		console.log(` → ${modules} modules, extracted ${files} files ✅`);
		results.push({ platform, ok: true, modules, files });
	} catch (e) {
		console.log(" → FAIL ❌");
		results.push({ platform, ok: false, error: e.message });
	}
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${"─".repeat(64)}`);
for (const r of results) {
	console.log(
		r.ok
			? `  ✅ ${r.platform.padEnd(18)} ${r.modules} modules → ${r.files} files`
			: `  ❌ ${r.platform.padEnd(18)} ${r.error}`,
	);
}
console.log("─".repeat(64));

if (failed.length > 0) {
	console.error(`\n✗ ${failed.length}/${results.length} platform(s) failed`);
	process.exit(1);
}
console.log(
	`\n✓ unbun parsed and extracted all ${results.length} Claude Code ${version} binaries`,
);
