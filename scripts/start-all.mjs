import { randomBytes } from "node:crypto";

const GENERATED_DEFAULTS = {
  DATABASE_URL: "file:./data/commute.db",
  DEFAULT_CITY: "宁波",
  DEFAULT_TIMEZONE: "Asia/Shanghai",
  OPENAI_BASE_URL: "https://api.openai.com/v1",
  OPENAI_MODEL: "gpt-4o-mini"
};

const REQUIRED_KEYS = [
  "DATABASE_URL",
  "DEFAULT_CITY",
  "DEFAULT_TIMEZONE",
  "AMAP_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL"
];

export function parseArgs(argv) {
  return {
    configure: argv.includes("--configure"),
    yes: argv.includes("--yes")
  };
}

export function parseDotEnv(text) {
  const lines = text.split(/\r?\n/);

  return {
    lines: lines.map((raw) => {
      const match = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

      if (!match) {
        return { type: "raw", raw };
      }

      return {
        type: "entry",
        key: match[1],
        value: match[2]
      };
    })
  };
}

export function serializeDotEnv(document) {
  return document.lines
    .map((line) => {
      if (line.type !== "entry") {
        return line.raw;
      }

      return `${line.key}=${line.value}`;
    })
    .join("\n");
}

export function getEnvValue(document, key) {
  const line = document.lines.find(
    (item) => item.type === "entry" && item.key === key
  );

  return line?.value;
}

export function setEnvValue(document, key, value) {
  const lines = [...document.lines];
  const index = lines.findIndex(
    (line) => line.type === "entry" && line.key === key
  );

  if (index === -1) {
    lines.push({ type: "entry", key, value });
  } else {
    lines[index] = { ...lines[index], value };
  }

  return { lines };
}

export function envDocumentToObject(document) {
  return document.lines.reduce((values, line) => {
    if (line.type === "entry") {
      values[line.key] = line.value;
    }

    return values;
  }, {});
}

export function createRandomGenerator() {
  return {
    token(bytes) {
      return randomBytes(bytes).toString("base64url");
    }
  };
}

export function applyGeneratedDefaults(values, generator) {
  const nextValues = { ...values };
  const generated = {};

  for (const [key, value] of Object.entries(GENERATED_DEFAULTS)) {
    if (isEmpty(nextValues[key])) {
      nextValues[key] = value;
    }
  }

  if (isEmpty(nextValues.SEED_USER_EMAIL)) {
    nextValues.SEED_USER_EMAIL = `user-${generator.token(6)}@example.local`;
    generated.seedUserEmail = nextValues.SEED_USER_EMAIL;
  }

  if (isEmpty(nextValues.SEED_USER_PASSWORD)) {
    nextValues.SEED_USER_PASSWORD = generator.token(18);
    generated.seedUserPassword = nextValues.SEED_USER_PASSWORD;
  }

  if (isEmpty(nextValues.SCHEDULER_TICK_SECRET)) {
    nextValues.SCHEDULER_TICK_SECRET = generator.token(24);
    generated.schedulerTickSecret = nextValues.SCHEDULER_TICK_SECRET;
  }

  return { values: nextValues, generated };
}

export function validateRequiredConfig(values) {
  return REQUIRED_KEYS.filter((key) => isEmpty(values[key]));
}

function isEmpty(value) {
  return value === undefined || value.trim() === "";
}
