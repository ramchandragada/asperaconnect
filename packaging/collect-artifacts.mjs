#!/usr/bin/env node
/**
 * Collect Tauri Linux artifacts into dist/release for sharing with testers.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cargoTarget =
  process.env.CARGO_TARGET_DIR ||
  join(root, "target") ||
  join(root, "apps/desktop/src-tauri/target");
const bundleDirs = [
  join(cargoTarget, "release/bundle"),
  join(root, "target/release/bundle"),
  join(root, "apps/desktop/src-tauri/target/release/bundle"),
];

const out = join(root, "dist/release");
mkdirSync(out, { recursive: true });

function findDebs() {
  const found = [];
  for (const bundle of bundleDirs) {
    const debDir = join(bundle, "deb");
    if (!existsSync(debDir)) continue;
    for (const name of readdirSync(debDir)) {
      if (name.endsWith(".deb")) found.push(join(debDir, name));
    }
  }
  return found;
}

const debs = findDebs();
const copied = [];
for (const src of debs) {
  const base = src.split("/").pop().replace(/ /g, "-").replace(/Aspera-Connect/gi, "aspera-connect");
  const dest = join(out, base.toLowerCase().includes("aspera") ? base : `aspera-connect_${base}`);
  // Prefer a clean canonical name when possible
  const canonical = join(out, "aspera-connect_0.1.0-beta.1_amd64.deb");
  cpSync(src, canonical);
  copied.push(canonical);
  if (dest !== canonical) {
    try {
      cpSync(src, dest);
    } catch {
      /* ignore */
    }
  }
}

cpSync(join(root, "TESTING.md"), join(out, "TESTING.md"));
cpSync(join(root, "NOTICE"), join(out, "NOTICE"));

const lines = [
  "# Aspera Connect 0.1.0-beta.1 — release folder",
  "",
  "Share the `.deb` with TESTING.md.",
  "",
  "## Artifacts",
  ...copied.map((p) => `- deb: ${p}`),
  "",
  "Install:",
  "  sudo apt install ./aspera-connect_0.1.0-beta.1_amd64.deb",
  "  # then follow TESTING.md for Snap scrcpy 3.x",
  "",
  `Generated: ${new Date().toISOString()}`,
];
writeFileSync(join(out, "SHARES.txt"), lines.join("\n"));
console.log(lines.join("\n"));
if (!copied.length) {
  console.error("No .deb found — did tauri build succeed?");
  process.exit(1);
}
