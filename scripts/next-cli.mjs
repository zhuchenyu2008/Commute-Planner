#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function configureWindowsSwcFallback() {
  if (process.platform !== "win32" || process.arch !== "x64" || process.env.NEXT_TEST_WASM_DIR) {
    return;
  }

  try {
    require("@next/swc-win32-x64-msvc");
  } catch (error) {
    if (error?.code !== "ERR_DLOPEN_FAILED") {
      return;
    }

    process.env.NEXT_TEST_WASM_DIR = dirname(require.resolve("@next/swc-wasm-nodejs"));
  }
}

configureWindowsSwcFallback();

const nextBin = require.resolve("next/dist/bin/next");
const result = spawnSync(process.execPath, [nextBin, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  shell: false
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
