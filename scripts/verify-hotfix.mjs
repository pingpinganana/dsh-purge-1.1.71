#!/usr/bin/env node
// Read-only verification for the v1.1.71 compatibility hotfix.
//
//   node scripts/verify-hotfix.mjs
//   node scripts/verify-hotfix.mjs --plugin <plugin-root> --host <dsh-system-prompt/lib/index.js>
//
// With --host it also simulates patch #40 against the real host file and
// writes the patched preview to the OS temp dir (never modifies the host).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const pluginRoot = path.resolve(arg("--plugin", path.resolve(here, "..")));
const hostFile = arg("--host", "");
const read = (p) => fs.readFileSync(p, "utf8");
const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : " FAIL "} ${label}${extra ? " - " + extra : ""}`);
  if (!ok) failures.push(label);
};

console.log("plugin root:", pluginRoot);

// --- static checks -------------------------------------------------------
const coreText = read(path.join(pluginRoot, "lib/core.js"));
const identityText = read(path.join(pluginRoot, "lib/identity.js"));
const patchText = read(path.join(pluginRoot, "cordis.patch.yml"));

check("no literal {{cwd}} in cordis.patch.yml", !patchText.includes("{{cwd}}"));
check("no literal {{cwd}} in lib/core.js", !coreText.includes("{{cwd}}"));
check("no literal {{cwd}} in lib/identity.js", !identityText.includes("{{cwd}}"));
check(
  "interpolation allowlist no longer contains cwd",
  /const DSH_INTERPOLATE_ALLOWED = new Set\(\[[^\]]*\]\)/.test(identityText) &&
    !/const DSH_INTERPOLATE_ALLOWED = new Set\(\[[^\]]*"cwd"/.test(identityText),
);
check(
  "#40 has the requiredContexts replacement",
  coreText.includes("COMPLETE_PROMPT_REQUIRED_CONTEXTS_INJECT") &&
    coreText.includes("[dsh-purge] complete prompt keeps inject"),
);
check(
  "restart gate allows soft skips with warnings",
  coreText.includes("warnings") && coreText.includes("isPatchResultSoftOk"),
);

// --- load the real patch table ------------------------------------------
let core;
try {
  core = await import(pathToFileURL(path.join(pluginRoot, "lib/core.js")).href);
  check("lib/core.js imports cleanly", true);
} catch (err) {
  check("lib/core.js imports cleanly", false, String(err && err.message));
}
const p40 = core && core.ALL_PATCHES && core.ALL_PATCHES.find((p) => p.id === 40);
check(
  "patch #40 present with >= 7 replacements",
  !!p40 && p40.replacements.length >= 7,
  p40 ? `${p40.replacements.length} replacements` : "not found",
);

// --- optional host simulation -------------------------------------------
if (hostFile) {
  if (!fs.existsSync(hostFile)) {
    check("host file exists", false, hostFile);
  } else {
    const text = read(hostFile);
    console.log("host file:", hostFile);
    let hitIndex = -1;
    p40.replacements.forEach((r, i) => {
      const hit = r.pattern instanceof RegExp
        ? r.pattern.test(text)
        : text.includes(String(r.pattern));
      if (hit && hitIndex < 0) hitIndex = i;
      console.log(`    replacement[${i}] ${hit ? "MATCH" : "miss"}`);
    });
    const injectMarkers = [
      "[dsh-purge] complete prompt keeps waterfall inject",
      "[dsh-purge] complete prompt keeps inject",
    ];
    if (hitIndex >= 0) {
      check("at least one #40 replacement matches this host", true, `first hit = ${hitIndex}`);
      const r = p40.replacements[hitIndex];
      const out = text.replace(r.pattern, r.replace);
      check("inject marker after simulated apply", injectMarkers.some((m) => out.includes(m)));
      check("identity marker present", out.includes("[dsh-purge] identity stripped"));
      check("requiredContexts preserved", out.includes("const requiredContexts = new Set("));
      check("no literal {{cwd}} in patched host", !out.includes("{{cwd}}"));
      const preview = path.join(os.tmpdir(), "dsh-purge-verify-host.mjs");
      fs.writeFileSync(preview, out, "utf8");
      console.log("patched host preview:", preview);
    } else if (injectMarkers.some((m) => text.includes(m))) {
      // Host was already patched by a previous "清洗 → 应用". Patterns no longer
      // match by design; verify the live result instead of reporting a false FAIL.
      console.log("  host already carries the hotfix markers (idempotent state)");
      check("inject marker present", true);
      check("identity marker present", text.includes("[dsh-purge] identity stripped"));
      check("requiredContexts preserved", text.includes("const requiredContexts = new Set("));
      check("no literal {{cwd}} in host", !text.includes("{{cwd}}"));
    } else {
      check("at least one #40 replacement matches this host", false, "host is neither clean nor patched");
    }
  }
} else {
  console.log("(no --host given; skipped host matching. Pass --host <.../dsh-system-prompt/lib/index.js> for a full check)");
}

console.log("RESULT:", failures.length ? "FAIL" : "PASS");
if (failures.length) {
  console.log("failed:", failures.join("; "));
  process.exit(1);
}
