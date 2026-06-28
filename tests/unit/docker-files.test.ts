import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Docker configuration", () => {
  it("defines web and scheduler services with persisted SQLite data", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");

    expect(compose).toContain("web:");
    expect(compose).toContain("scheduler:");
    expect(compose).toContain("./data:/app/data");
    expect(compose).toContain("env_file:");
    expect(compose).toContain("DATABASE_URL: file:/app/data/commute.db");
  });

  it("documents local and docker operation commands", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("npm run dev");
    expect(readme).toContain("docker compose up --build");
    expect(readme).toContain("npm run scheduler:tick");
  });
});
