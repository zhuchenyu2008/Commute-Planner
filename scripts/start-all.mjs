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
  const line = findLastEnvEntry(document.lines, key);

  return line?.value;
}

export function setEnvValue(document, key, value) {
  const lines = [...document.lines];
  const index = findLastEnvEntryIndex(lines, key);

  if (index === -1) {
    const insertAt = isTrailingBlankRawLine(lines)
      ? lines.length - 1
      : lines.length;
    lines.splice(insertAt, 0, { type: "entry", key, value });
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

export function applyGeneratedDefaults(
  values,
  generator = createRandomGenerator()
) {
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

async function promptForKey({ key, currentValue, prompt }) {
  const defaultValue = currentValue?.trim() || GENERATED_DEFAULTS[key] || "";
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await prompt(`${key}${suffix}: `, defaultValue);

  return answer.trim() || defaultValue;
}

function shouldPromptForKey({ key, args, values }) {
  if (args.yes) {
    return false;
  }

  if (args.configure) {
    return REQUIRED_KEYS.includes(key);
  }

  return REQUIRED_KEYS.includes(key) && isEmpty(values[key]);
}

export async function prepareConfiguration({
  envText,
  exampleText,
  args,
  prompt,
  generator = createRandomGenerator()
}) {
  let document = parseDotEnv(envText ?? exampleText);
  let values = envDocumentToObject(document);
  const generatedResult = applyGeneratedDefaults(values, generator);
  values = generatedResult.values;

  for (const [key, value] of Object.entries(values)) {
    document = setEnvValue(document, key, value);
  }

  for (const key of REQUIRED_KEYS) {
    if (shouldPromptForKey({ key, args, values })) {
      values[key] = await promptForKey({
        key,
        currentValue: values[key],
        prompt
      });
      document = setEnvValue(document, key, values[key]);
    }
  }

  const missing = validateRequiredConfig(values);

  return {
    envText: serializeDotEnv(document),
    values,
    generated: generatedResult.generated,
    missing
  };
}

export function getPreparationCommands() {
  return [
    ["npm", "install"],
    ["npm", "run", "prisma:generate"],
    ["npm", "run", "prisma:deploy"],
    ["npm", "run", "prisma:seed"],
    ["npm", "run", "build"]
  ];
}

export function buildServicePlan(values) {
  const services = [
    { name: "web", command: ["npm", "run", "start"], kind: "process" },
    {
      name: "scheduler",
      command: ["npm", "run", "scheduler:tick"],
      kind: "scheduler"
    }
  ];

  if (values.TELEGRAM_BOT_TOKEN?.trim()) {
    services.push({
      name: "telegram",
      command: ["npm", "run", "telegram:poll"],
      kind: "process"
    });
  }

  return services;
}

function isEmpty(value) {
  return value === undefined || value.trim() === "";
}

function findLastEnvEntry(lines, key) {
  const index = findLastEnvEntryIndex(lines, key);

  if (index === -1) {
    return undefined;
  }

  return lines[index];
}

function findLastEnvEntryIndex(lines, key) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];

    if (line.type === "entry" && line.key === key) {
      return index;
    }
  }

  return -1;
}

function isTrailingBlankRawLine(lines) {
  const lastLine = lines.at(-1);

  return lastLine?.type === "raw" && lastLine.raw === "";
}
