// Sample app for the e2e matrix (scripts/e2e/run.mjs).
//
// It is compiled with `bun build --compile` across many Bun versions and
// targets, then unpacked with unbun to prove the round-trip works on real
// binaries. The marker string must survive bundling so the runner can find it
// in the extracted source.

const MARKER = "UNBUN_E2E_MARKER";

function describe(): string {
	return `${MARKER} ${process.platform}/${process.arch}`;
}

console.log(describe());
