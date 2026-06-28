import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("e2e runner", () => {
  it("uses the repository-owned server lifecycle script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["test:e2e"]).toBe("node scripts/e2e.mjs");
  });

  it("does not rely on Playwright webServer shutdown", () => {
    const config = readFileSync("playwright.config.ts", "utf8");

    expect(config).not.toContain("webServer");
  });

  it("runs Playwright against the same configurable port as the Next server", () => {
    const runner = readFileSync("scripts/e2e.mjs", "utf8");
    const config = readFileSync("playwright.config.ts", "utf8");

    expect(runner).toContain("E2E_PORT");
    expect(runner).toContain("next-cli.mjs\", \"start\", \"-p\", e2ePort");
    expect(runner).toContain("PLAYWRIGHT_BASE_URL");
    expect(config).toContain("process.env.PLAYWRIGHT_BASE_URL");
  });
});
