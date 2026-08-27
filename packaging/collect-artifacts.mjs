#!/usr/bin/env node
/**
 * Collect release artifacts with simple names for non-technical testers.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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
cpSync(debSrc, join(out, "aspera-connect_0.1.0-beta.1_amd64.deb"));

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
  `Aspera Connect — install (2 files)
================================

PC (Linux Mint / Ubuntu)
  1. Download: AsperaConnect-Desktop.deb
  2. Double-click it → Install (or: sudo apt install ./AsperaConnect-Desktop.deb)
  3. Open "Aspera Connect" from the app menu

Phone (Android)
  1. Download: AsperaConnect-Phone.apk  (open link on the phone)
  2. Allow install → Install
  3. Open app → Start for calls → note the IP address

Connect
  1. On PC: Phone calls → enter phone IP → Connect for phone calls
  2. Same office Wi-Fi (same band if router has 2.4 GHz and 5 GHz)

That's it.
`,
);

writeFileSync(
  join(out, "SHARES.txt"),
  `Give testers these 2 files (+ this note):

  AsperaConnect-Desktop.deb   → PC install (double-click)
  AsperaConnect-Phone.apk    → Phone install (open on Android)

See INSTALL.txt for 3-step setup.
`,
);

console.log("Release folder ready:", out);
console.log(" -", DESKTOP_DEB);
if (apkCopied) console.log(" -", PHONE_APK);
console.log(" - INSTALL.txt");
