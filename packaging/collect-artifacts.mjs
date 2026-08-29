#!/usr/bin/env node
/**
 * Collect release artifacts with simple names for non-technical testers.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cargoTarget = process.env.CARGO_TARGET_DIR || join(root, "target");
const bundleDirs = [
  join(cargoTarget, "release/bundle"),
  join(root, "target/release/bundle"),
  join(root, "apps/desktop/src-tauri/target/release/bundle"),
];

const out = join(root, "dist/release");
mkdirSync(out, { recursive: true });

const DESKTOP_DEB = "AsperaConnect-Desktop.deb";
const PHONE_APK = "AsperaConnect-Phone.apk";

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
if (!debs.length) {
  console.error("No .deb found — run npm run tauri:build first");
  process.exit(1);
}

// Newest deb wins (same name, last in list from target dir)
const debSrc = debs[debs.length - 1];
const debDest = join(out, DESKTOP_DEB);
cpSync(debSrc, debDest);
cpSync(debSrc, join(out, "aspera-connect_0.1.0-beta.5_amd64.deb"));

// Phone APK — prefer newest built release APK, else copy versioned file
const apkCandidates = [
  join(root, "apps/android/app/build/outputs/apk/release/app-release.apk"),
  join(out, "AsperaConnect-0.3.6.apk"),
];
let apkCopied = false;
for (const src of apkCandidates) {
  if (existsSync(src)) {
    cpSync(src, join(out, PHONE_APK));
    apkCopied = true;
    break;
  }
}
if (!apkCopied) {
  console.warn("No APK found — build Android release APK first");
}

writeFileSync(
  join(out, "INSTALL.txt"),
  readFileSync(join(root, "dist/release/INSTALL.txt"), "utf8"),
);

const troubleSrc = join(root, "dist/release/TROUBLESHOOTING.txt");
const troubleDest = join(out, "TROUBLESHOOTING.txt");
if (existsSync(troubleSrc) && troubleSrc !== troubleDest) {
  cpSync(troubleSrc, troubleDest);
}

writeFileSync(
  join(out, "SHARES.txt"),
  `Give testers these files:

  AsperaConnect-Desktop.deb   → PC install (double-click)
  AsperaConnect-Phone.apk      → Phone install (open on Android)
  INSTALL.txt                  → 3-step setup
  TROUBLESHOOTING.txt          → if something goes wrong

See INSTALL.txt for setup.
`,
);

console.log("Release folder ready:", out);
console.log(" -", DESKTOP_DEB);
if (apkCopied) console.log(" -", PHONE_APK);
console.log(" - INSTALL.txt");
console.log(" - TROUBLESHOOTING.txt");
