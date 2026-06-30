import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type EnvDocument = unknown;

type StartAllModule = {
  parseArgs: (argv: string[]) => { configure: boolean; yes: boolean };
  parseDotEnv: (text: string) => EnvDocument;
  serializeDotEnv: (document: EnvDocument) => string;
  getEnvValue: (document: EnvDocument, key: string) => string | undefined;
  setEnvValue: (document: EnvDocument, key: string, value: string) => EnvDocument;
  envDocumentToObject: (document: EnvDocument) => Record<string, string>;
  applyGeneratedDefaults: (
    values: Record<string, string>,
    generator: { token: (bytes: number) => string }
  ) => {
    values: Record<string, string>;
    generated: {
      seedUserEmail?: string;
      seedUserPassword?: string;
      schedulerTickSecret?: string;
    };
  };
  validateRequiredConfig: (values: Record<string, string>) => string[];
};

async function loadStartAll(): Promise<StartAllModule> {
  const url = pathToFileURL(resolve("scripts/start-all.mjs")).href;
  return (await import(url)) as StartAllModule;
}

describe("native one-click deployment config", () => {
  it("parses arguments for configure and non-interactive modes", async () => {
    const { parseArgs } = await loadStartAll();

    expect(parseArgs(["--configure"])).toEqual({ configure: true, yes: false });
    expect(parseArgs(["--yes"])).toEqual({ configure: false, yes: true });
    expect(parseArgs(["--configure", "--yes"])).toEqual({
      configure: true,
      yes: true
    });
  });

  it("updates env values while preserving comments and unrelated keys", async () => {
    const { getEnvValue, parseDotEnv, serializeDotEnv, setEnvValue } =
      await loadStartAll();

    const original = [
      "# Local database",
      "DATABASE_URL=file:./old.db",
      "",
      "AMAP_API_KEY=",
      "SMTP_HOST=smtp.example.com"
    ].join("\n");

    let document = parseDotEnv(original);
    expect(getEnvValue(document, "DATABASE_URL")).toBe("file:./old.db");

    document = setEnvValue(document, "DATABASE_URL", "file:./data/commute.db");
    document = setEnvValue(document, "OPENAI_MODEL", "gpt-4o-mini");

    expect(serializeDotEnv(document)).toContain("# Local database");
    expect(serializeDotEnv(document)).toContain(
      "DATABASE_URL=file:./data/commute.db"
    );
    expect(serializeDotEnv(document)).toContain("SMTP_HOST=smtp.example.com");
    expect(serializeDotEnv(document)).toContain("OPENAI_MODEL=gpt-4o-mini");
  });

  it("generates seed credentials and scheduler secret when they are empty", async () => {
    const { applyGeneratedDefaults } = await loadStartAll();
    const generator = {
      token: (bytes: number) => `token-${bytes}`
    };

    const result = applyGeneratedDefaults(
      {
        DATABASE_URL: "",
        DEFAULT_CITY: "",
        DEFAULT_TIMEZONE: "",
        OPENAI_BASE_URL: "",
        OPENAI_MODEL: "",
        SEED_USER_EMAIL: "",
        SEED_USER_PASSWORD: "",
        SCHEDULER_TICK_SECRET: ""
      },
      generator
    );

    expect(result.values.DATABASE_URL).toBe("file:./data/commute.db");
    expect(result.values.DEFAULT_TIMEZONE).toBe("Asia/Shanghai");
    expect(result.values.OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
    expect(result.values.OPENAI_MODEL).toBe("gpt-4o-mini");
    expect(result.values.SEED_USER_EMAIL).toBe("user-token-6@example.local");
    expect(result.values.SEED_USER_PASSWORD).toBe("token-18");
    expect(result.values.SCHEDULER_TICK_SECRET).toBe("token-24");
    expect(result.generated).toEqual({
      seedUserEmail: "user-token-6@example.local",
      seedUserPassword: "token-18",
      schedulerTickSecret: "token-24"
    });
  });

  it("requires AMap and AI agent settings before deployment can start", async () => {
    const { validateRequiredConfig } = await loadStartAll();

    expect(
      validateRequiredConfig({
        DATABASE_URL: "file:./data/commute.db",
        DEFAULT_CITY: "宁波",
        DEFAULT_TIMEZONE: "Asia/Shanghai",
        AMAP_API_KEY: "",
        OPENAI_API_KEY: "",
        OPENAI_BASE_URL: "https://api.openai.com/v1",
        OPENAI_MODEL: ""
      })
    ).toEqual(["AMAP_API_KEY", "OPENAI_API_KEY", "OPENAI_MODEL"]);

    expect(
      validateRequiredConfig({
        DATABASE_URL: "file:./data/commute.db",
        DEFAULT_CITY: "宁波",
        DEFAULT_TIMEZONE: "Asia/Shanghai",
        AMAP_API_KEY: "amap-key",
        OPENAI_API_KEY: "openai-key",
        OPENAI_BASE_URL: "https://api.openai.com/v1",
        OPENAI_MODEL: "gpt-4o-mini"
      })
    ).toEqual([]);
  });
});
