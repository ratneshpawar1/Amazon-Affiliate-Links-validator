// Build script (esbuild). Produces a loadable MV3 `dist/`.
//
// Why hand-rolled esbuild instead of Vite+CRXJS: the service worker and the
// offscreen/UI pages ship as ES modules, but a content script injected via
// chrome.scripting must be a self-contained IIFE (no runtime `import`). Those
// two output formats are exactly where a single Vite multi-entry build fights
// you; here we just run esbuild twice with the right `format` for each.
//
// The OAuth Client ID is read from src/config.ts and injected into the emitted
// manifest, so config.ts stays the single source of user-specific values.

import * as esbuild from "esbuild";
import { readFile, writeFile, mkdir, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");
const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  target: ["chrome120"],
  jsx: "automatic",
  jsxImportSource: "preact",
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  legalComments: "none",
};

// ES-module outputs: service worker, offscreen doc, and the two UI pages.
const esmEntries = {
  background: resolve(root, "src/background.ts"),
  offscreen: resolve(root, "src/offscreen/offscreen.ts"),
  popup: resolve(root, "src/popup/popup.tsx"),
  dashboard: resolve(root, "src/dashboard/dashboard.tsx"),
};

// IIFE output: the Amazon probe content script (no runtime imports allowed).
const iifeEntries = {
  "amazon-probe": resolve(root, "src/content/amazon-probe.ts"),
};

// Static files copied verbatim into dist.
const staticFiles = [
  "src/popup/popup.html",
  "src/dashboard/dashboard.html",
  "src/offscreen/offscreen.html",
];

/** Read the typed config.ts (or fall back to config.example.ts) at build time. */
async function loadConfig() {
  const configPath = existsSync(resolve(root, "src/config.ts"))
    ? resolve(root, "src/config.ts")
    : resolve(root, "src/config.example.ts");
  const built = await esbuild.build({
    entryPoints: [configPath],
    bundle: true,
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const code = built.outputFiles[0].text;
  const mod = await import(
    "data:text/javascript;base64," + Buffer.from(code).toString("base64")
  );
  return mod.config;
}

/** Emit dist/manifest.json, injecting the OAuth client ID and optional key. */
async function writeManifest() {
  const template = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  const scopes = template.oauth2?.scopes ?? [
    "https://www.googleapis.com/auth/youtube.readonly",
  ];
  const cfg = await loadConfig();

  delete template.oauth2;
  delete template.key;

  if (cfg.oauthClientId && cfg.oauthClientId.trim()) {
    template.oauth2 = { client_id: cfg.oauthClientId.trim(), scopes };
  } else {
    // No client ID yet: omit oauth2 so the manifest still loads cleanly.
    // auth.ts detects the missing ID and shows a friendly SETUP.md pointer
    // before any getAuthToken call is attempted.
    console.warn(
      "\n⚠  No oauthClientId in src/config.ts — building without OAuth.\n" +
        "   The extension will load but prompt you to finish SETUP.md step 3.\n"
    );
  }
  if (cfg.extensionKey && cfg.extensionKey.trim()) {
    template.key = cfg.extensionKey.trim();
  }
  await writeFile(
    resolve(dist, "manifest.json"),
    JSON.stringify(template, null, 2) + "\n"
  );
}

async function copyStatic() {
  for (const rel of staticFiles) {
    const base = rel.split("/").pop();
    await copyFile(resolve(root, rel), resolve(dist, base));
  }
}

async function buildOnce() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await esbuild.build({ ...shared, entryPoints: esmEntries, format: "esm", outdir: dist });
  await esbuild.build({ ...shared, entryPoints: iifeEntries, format: "iife", outdir: dist });
  await copyStatic();
  await writeManifest();
  console.log("✓ built dist/");
}

if (watch) {
  // Rebuild-on-change: crude but dependable — rebuild everything on any change.
  await buildOnce();
  const { watch: fsWatch } = await import("node:fs");
  let timer = null;
  fsWatch(resolve(root, "src"), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => buildOnce().catch((e) => console.error(e)), 150);
  });
  console.log("watching src/ …");
} else {
  await buildOnce();
}
