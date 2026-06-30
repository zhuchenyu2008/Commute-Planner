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
    generator?: { token: (bytes: number) => string }
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

type PrepareConfigurationInput = {
  envText: string | undefined;
  exampleText: string;
  args: { configure: boolean; yes: boolean };
  prompt: (question: string, defaultValue?: string) => Promise<string>;
  generator: { token: (bytes: number) => string };
};

type StartAllModuleWithRuntime = StartAllModule & {
  prepareConfiguration: (
    input: PrepareConfigurationInput
  ) => Promise<{
    envText: string;
    values: Record<string, string>;
    generated: {
      seedUserEmail?: string;
      seedUserPassword?: string;
      schedulerTickSecret?: string;
    };
    missing: string[];
  }>;
  getPreparationCommands: () => string[][];
  buildServicePlan: (
    values: Record<string, string>
  ) => Array<{ name: string; command: string[]; kind: "process" | "scheduler" }>;
};

async function loadRuntimeStartAll(): Promise<StartAllModuleWithRuntime> {
  const url = pathToFileURL(resolve("scripts/start-all.mjs")).href;
  return (await import(url)) as StartAllModuleWithRuntime;
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

    const original =
      [
        "# Local database",
        "DATABASE_URL=file:./old.db",
        "",
        "AMAP_API_KEY=",
        "SMTP_HOST=smtp.example.com"
      ].join("\n") + "\n";

    const expected = [
      "# Local database",
      "DATABASE_URL=file:./data/commute.db",
      "",
      "AMAP_API_KEY=",
      "SMTP_HOST=smtp.example.com",
      "OPENAI_MODEL=gpt-4o-mini",
      ""
    ].join("\n");

    let document = parseDotEnv(original);
    expect(getEnvValue(document, "DATABASE_URL")).toBe("file:./old.db");

    document = setEnvValue(document, "DATABASE_URL", "file:./data/commute.db");
    document = setEnvValue(document, "OPENAI_MODEL", "gpt-4o-mini");

    expect(serializeDotEnv(document)).toBe(expected);
  });

  it("uses the last duplicate env key when reading and updating values", async () => {
    const {
      envDocumentToObject,
      getEnvValue,
      parseDotEnv,
      serializeDotEnv,
      setEnvValue
    } = await loadStartAll();

    let document = parseDotEnv(
      ["OPENAI_MODEL=old", "AMAP_API_KEY=amap-key", "OPENAI_MODEL=new"].join(
        "\n"
      )
    );

    expect(getEnvValue(document, "OPENAI_MODEL")).toBe("new");

    document = setEnvValue(document, "OPENAI_MODEL", "final");

    expect(serializeDotEnv(document)).toBe(
      ["OPENAI_MODEL=old", "AMAP_API_KEY=amap-key", "OPENAI_MODEL=final"].join(
        "\n"
      )
    );
    expect(envDocumentToObject(document).OPENAI_MODEL).toBe("final");
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
    expect(result.values.DEFAULT_CITY).toBe("宁波");
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

  it("generates credentials with the default random generator", async () => {
    const { applyGeneratedDefaults } = await loadStartAll();

    const result = applyGeneratedDefaults({
      DATABASE_URL: "",
      DEFAULT_CITY: "",
      DEFAULT_TIMEZONE: "",
      OPENAI_BASE_URL: "",
      OPENAI_MODEL: "",
      SEED_USER_EMAIL: "",
      SEED_USER_PASSWORD: "",
      SCHEDULER_TICK_SECRET: ""
    });

    expect(result.values.SEED_USER_EMAIL).toMatch(
      /^user-[A-Za-z0-9_-]+@example\.local$/
    );
    expect(result.values.SEED_USER_PASSWORD).toEqual(expect.any(String));
    expect(result.values.SEED_USER_PASSWORD).not.toBe("");
    expect(result.values.SCHEDULER_TICK_SECRET).toEqual(expect.any(String));
    expect(result.values.SCHEDULER_TICK_SECRET).not.toBe("");
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

describe("native one-click deployment runtime planning", () => {
  it("prompts for required AMap and AI values in interactive mode", async () => {
    const { prepareConfiguration } = await loadRuntimeStartAll();
    const answers = new Map([
      ["AMAP_API_KEY", "amap-key"],
      ["OPENAI_API_KEY", "openai-key"],
      ["OPENAI_BASE_URL", "https://api.openai.com/v1"],
      ["OPENAI_MODEL", "gpt-4o-mini"]
    ]);
    const promptedKeys: string[] = [];

    const result = await prepareConfiguration({
      envText: [
        "DATABASE_URL=",
        "DEFAULT_CITY=",
        "DEFAULT_TIMEZONE=",
        "AMAP_API_KEY=",
        "OPENAI_API_KEY=",
        "OPENAI_BASE_URL=",
        "OPENAI_MODEL="
      ].join("\n"),
      exampleText: "",
      args: { configure: false, yes: false },
      prompt: async (question, defaultValue) => {
        const key = question.match(/^([A-Z0-9_]+)/)?.[1];
        if (key) {
          promptedKeys.push(key);
        }
        return key ? answers.get(key) ?? defaultValue ?? "" : defaultValue ?? "";
      },
      generator: { token: (bytes) => `token-${bytes}` }
    });

    expect(promptedKeys).toEqual([
      "AMAP_API_KEY",
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "OPENAI_MODEL"
    ]);
    expect(result.missing).toEqual([]);
    expect(result.values.AMAP_API_KEY).toBe("amap-key");
    expect(result.values.OPENAI_API_KEY).toBe("openai-key");
    expect(result.envText).toContain("SEED_USER_EMAIL=user-token-6@example.local");
    expect(result.generated.seedUserPassword).toBe("token-18");
  });

  it("does not prompt or invent required service keys in yes mode", async () => {
    const { prepareConfiguration } = await loadRuntimeStartAll();

    const result = await prepareConfiguration({
      envText: "DATABASE_URL=\nAMAP_API_KEY=\nOPENAI_API_KEY=\nOPENAI_MODEL=\n",
      exampleText: "",
      args: { configure: false, yes: true },
      prompt: async () => {
        throw new Error("prompt should not be called in --yes mode");
      },
      generator: { token: (bytes) => `token-${bytes}` }
    });

    expect(result.missing).toEqual(["AMAP_API_KEY", "OPENAI_API_KEY"]);
    expect(result.values.DATABASE_URL).toBe("file:./data/commute.db");
    expect(result.values.OPENAI_MODEL).toBe("gpt-4o-mini");
  });

  it("prepares install, prisma, seed, and production build commands", async () => {
    const { getPreparationCommands } = await loadRuntimeStartAll();

    expect(getPreparationCommands()).toEqual([
      ["npm", "install"],
      ["npm", "run", "prisma:generate"],
      ["npm", "run", "prisma:deploy"],
      ["npm", "run", "prisma:seed"],
      ["npm", "run", "build"]
    ]);
  });

  it("starts Telegram only when a bot token is configured", async () => {
    const { buildServicePlan } = await loadRuntimeStartAll();

    expect(buildServicePlan({ TELEGRAM_BOT_TOKEN: "" }).map((service) => service.name))
      .toEqual(["web", "scheduler"]);
    expect(buildServicePlan({ TELEGRAM_BOT_TOKEN: "bot-token" }).map((service) => service.name))
      .toEqual(["web", "scheduler", "telegram"]);
  });
});
