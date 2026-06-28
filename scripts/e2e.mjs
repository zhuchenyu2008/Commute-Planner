#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const isWindows = process.platform === "win32";
const e2ePort = process.env.E2E_PORT ?? "3100";
const baseUrl = `http://127.0.0.1:${e2ePort}`;
const env = {
  ...process.env,
  AMAP_API_KEY: "",
  OPENAI_API_KEY: "",
  OPENAI_BASE_URL: "",
  OPENAI_MODEL: "",
  DATABASE_URL: process.env.DATABASE_URL ?? "file:./e2e-test.db",
  E2E_PORT: e2ePort,
  PLAYWRIGHT_BASE_URL: baseUrl,
};

if (isWindows && !env.NEXT_TEST_WASM_DIR) {
  env.NEXT_TEST_WASM_DIR = dirname(require.resolve("@next/swc-wasm-nodejs"));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      shell: false,
      stdio: options.stdio ?? "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function waitForServer(url, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    async function probe() {
      try {
        const response = await fetch(url);
        if (response.ok || response.status < 500) {
          resolve();
          return;
        }
      } catch {
        // Server is not ready yet.
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }

      setTimeout(probe, 500);
    }

    void probe();
  });
}

async function main() {
  await run(process.execPath, ["scripts/next-cli.mjs", "build"]);

  const server = spawn(process.execPath, ["scripts/next-cli.mjs", "start", "-p", e2ePort], {
    cwd: process.cwd(),
    env,
    shell: false,
    stdio: "inherit",
  });

  try {
    await waitForServer(`${baseUrl}/login`, 30_000);
    await run(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        ...process.argv.slice(2),
      ]
    );
  } finally {
    server.kill("SIGTERM");
    if (isWindows && server.pid) {
      spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
