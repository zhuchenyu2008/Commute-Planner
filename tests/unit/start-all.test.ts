import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
  createChildEnv: (
    values: Record<string, string>,
    baseEnv?: Record<string, string | undefined>
  ) => Record<string, string | undefined>;
  normalizeCommand: (
    command: string[],
    platform?: NodeJS.Platform
  ) => { command: string; args: string[]; shell: boolean };
  main: (argv?: string[], cwd?: string) => Promise<void>;
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

  it("prompts all required values in configure mode even when already set", async () => {
    const { prepareConfiguration } = await loadRuntimeStartAll();
    const promptedKeys: string[] = [];

    const result = await prepareConfiguration({
      envText: [
        "DATABASE_URL=file:./data/commute.db",
        "DEFAULT_CITY=宁波",
        "DEFAULT_TIMEZONE=Asia/Shanghai",
        "AMAP_API_KEY=amap-key",
        "OPENAI_API_KEY=openai-key",
        "OPENAI_BASE_URL=https://api.openai.com/v1",
        "OPENAI_MODEL=gpt-4o-mini"
      ].join("\n"),
      exampleText: "",
      args: { configure: true, yes: false },
      prompt: async (question) => {
        const key = question.match(/^([A-Z0-9_]+)/)?.[1] ?? "";
        promptedKeys.push(key);
        return `${key.toLowerCase()}-updated`;
      },
      generator: { token: (bytes) => `token-${bytes}` }
    });

    expect(promptedKeys).toEqual([
      "DATABASE_URL",
      "DEFAULT_CITY",
      "DEFAULT_TIMEZONE",
      "AMAP_API_KEY",
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "OPENAI_MODEL"
    ]);
    expect(result.values.AMAP_API_KEY).toBe("amap_api_key-updated");
    expect(result.values.OPENAI_API_KEY).toBe("openai_api_key-updated");
    expect(result.missing).toEqual([]);
  });

  it("redacts configured secrets in configure prompts while preserving defaults", async () => {
    const { prepareConfiguration } = await loadRuntimeStartAll();
    const questions: string[] = [];

    const result = await prepareConfiguration({
      envText: [
        "DATABASE_URL=file:./data/commute.db",
        "DEFAULT_CITY=宁波",
        "DEFAULT_TIMEZONE=Asia/Shanghai",
        "AMAP_API_KEY=amap-secret",
        "OPENAI_API_KEY=sk-secret",
        "OPENAI_BASE_URL=https://api.openai.com/v1",
        "OPENAI_MODEL=gpt-4o-mini"
      ].join("\n"),
      exampleText: "",
      args: { configure: true, yes: false },
      prompt: async (question) => {
        questions.push(question);
        return "";
      },
      generator: { token: (bytes) => `token-${bytes}` }
    });

    const amapQuestion = questions.find((question) =>
      question.startsWith("AMAP_API_KEY")
    );
    const openAiQuestion = questions.find((question) =>
      question.startsWith("OPENAI_API_KEY")
    );

    expect(amapQuestion).not.toContain("amap-secret");
    expect(openAiQuestion).not.toContain("sk-secret");
    expect(amapQuestion).toContain("[configured]");
    expect(openAiQuestion).toContain("[configured]");
    expect(result.values.AMAP_API_KEY).toBe("amap-secret");
    expect(result.values.OPENAI_API_KEY).toBe("sk-secret");
  });

  it("does not prompt for existing service config in interactive mode", async () => {
    const { prepareConfiguration } = await loadRuntimeStartAll();

    const result = await prepareConfiguration({
      envText: [
        "DATABASE_URL=file:./data/commute.db",
        "DEFAULT_CITY=宁波",
        "DEFAULT_TIMEZONE=Asia/Shanghai",
        "AMAP_API_KEY=amap-key",
        "OPENAI_API_KEY=openai-key",
        "OPENAI_BASE_URL=https://api.openai.com/v1",
        "OPENAI_MODEL=gpt-4o-mini"
      ].join("\n"),
      exampleText: "",
      args: { configure: false, yes: false },
      prompt: async () => {
        throw new Error("prompt should not be called when service config exists");
      },
      generator: { token: (bytes) => `token-${bytes}` }
    });

    expect(result.values.AMAP_API_KEY).toBe("amap-key");
    expect(result.values.OPENAI_API_KEY).toBe("openai-key");
    expect(result.values.OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
    expect(result.values.OPENAI_MODEL).toBe("gpt-4o-mini");
    expect(result.envText).toContain("AMAP_API_KEY=amap-key");
    expect(result.envText).toContain("OPENAI_API_KEY=openai-key");
    expect(result.envText).toContain("OPENAI_BASE_URL=https://api.openai.com/v1");
    expect(result.envText).toContain("OPENAI_MODEL=gpt-4o-mini");
  });

  it("preserves existing optional runtime values during preparation", async () => {
    const { prepareConfiguration } = await loadRuntimeStartAll();

    const result = await prepareConfiguration({
      envText: [
        "DATABASE_URL=file:./data/commute.db",
        "DEFAULT_CITY=宁波",
        "DEFAULT_TIMEZONE=Asia/Shanghai",
        "AMAP_API_KEY=amap-key",
        "OPENAI_API_KEY=openai-key",
        "OPENAI_BASE_URL=https://api.openai.com/v1",
        "OPENAI_MODEL=gpt-4o-mini",
        "TELEGRAM_BOT_TOKEN=bot-token",
        "SMTP_HOST=smtp.example.com",
        "SEED_USER_EMAIL=existing@example.com",
        "SEED_USER_PASSWORD=existing-password",
        "SCHEDULER_TICK_SECRET=existing-secret"
      ].join("\n"),
      exampleText: "",
      args: { configure: false, yes: true },
      prompt: async () => {
        throw new Error("prompt should not be called in --yes mode");
      },
      generator: { token: (bytes) => `token-${bytes}` }
    });

    expect(result.values.TELEGRAM_BOT_TOKEN).toBe("bot-token");
    expect(result.values.SMTP_HOST).toBe("smtp.example.com");
    expect(result.values.SEED_USER_EMAIL).toBe("existing@example.com");
    expect(result.values.SEED_USER_PASSWORD).toBe("existing-password");
    expect(result.values.SCHEDULER_TICK_SECRET).toBe("existing-secret");
    expect(result.envText).toContain("TELEGRAM_BOT_TOKEN=bot-token");
    expect(result.envText).toContain("SMTP_HOST=smtp.example.com");
    expect(result.envText).toContain("SEED_USER_EMAIL=existing@example.com");
    expect(result.envText).toContain("SEED_USER_PASSWORD=existing-password");
    expect(result.envText).toContain("SCHEDULER_TICK_SECRET=existing-secret");
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

  it("merges prepared values into child process env with prepared values winning", async () => {
    const { createChildEnv } = await loadRuntimeStartAll();

    expect(
      createChildEnv(
        {
          DATABASE_URL: "file:./data/commute.db",
          OPENAI_API_KEY: "prepared-key"
        },
        {
          DATABASE_URL: "file:./parent.db",
          PATH: "parent-path"
        }
      )
    ).toEqual({
      DATABASE_URL: "file:./data/commute.db",
      OPENAI_API_KEY: "prepared-key",
      PATH: "parent-path"
    });
  });

  it("normalizes npm commands without shelling through Windows command processors", async () => {
    const { normalizeCommand } = await loadRuntimeStartAll();

    expect(normalizeCommand(["npm", "run", "start"], "win32")).toEqual({
      command: "npm.cmd",
      args: ["run", "start"],
      shell: false
    });
    expect(normalizeCommand(["npm", "run", "start"], "linux")).toEqual({
      command: "npm",
      args: ["run", "start"],
      shell: false
    });
  });

  it("describes saved configuration when required values are still missing", async () => {
    const { main } = await loadRuntimeStartAll();
    const cwd = mkdtempSync(join(tmpdir(), "start-all-missing-"));
    writeFileSync(
      join(cwd, ".env.example"),
      "AMAP_API_KEY=\nOPENAI_API_KEY=\nOPENAI_MODEL=\n",
      "utf8"
    );

    try {
      await expect(main(["--yes"], cwd)).rejects.toThrow(
        "Saved current configuration to .env; fill the missing values and run again."
      );

      expect(readFileSync(join(cwd, ".env"), "utf8")).toContain(
        "DATABASE_URL=file:./data/commute.db"
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("native one-click deployment wrappers", () => {
  it("exposes the start:all npm script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["start:all"]).toBe("node scripts/start-all.mjs");
  });

  it("provides Windows and Linux wrapper scripts", () => {
    const ps1 = readFileSync("start-all.ps1", "utf8");
    const cmd = readFileSync("start-all.cmd", "utf8");
    const sh = readFileSync("start-all.sh", "utf8");

    expect(ps1).toContain("scripts/start-all.mjs");
    expect(ps1).toContain("-Configure");
    expect(ps1).toContain("-Yes");
    expect(cmd).toContain("start-all.ps1");
    expect(sh).toContain("scripts/start-all.mjs");
    expect(sh).toContain("--configure");
    expect(sh).toContain("--yes");
  });
});

describe("native one-click deployment documentation", () => {
  it("documents the native deployment path beside Docker", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("本机一键部署");
    expect(readme).toContain("start-all.cmd");
    expect(readme).toContain("start-all.ps1");
    expect(readme).toContain("start-all.sh");
    expect(readme).toContain("AMAP_API_KEY");
    expect(readme).toContain("OPENAI_API_KEY");
  });
});
