# Telegram Agent Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram long-polling entrypoint that lets a bound Telegram chat create trips, continue Agent conversations, switch active trips with inline buttons, and cancel monitoring.

**Architecture:** Add a small Telegram transport layer around the existing Agent and trip services. Persist bot polling offset and per-chat active context in Prisma; route inbound Telegram messages and callback queries to the same planning/continuation services used by the website. Keep reminders in the scheduler and keep Telegram worker focused on inbound chat state.

**Tech Stack:** Next.js App Router service modules, TypeScript, Prisma/SQLite, Vitest, native `fetch`, Telegram Bot API long polling.

---

## File Map

- `prisma/schema.prisma`: add `TelegramChatState` and `TelegramBotState`, plus relation arrays on `User`, `AgentSession`, and `Trip`.
- `prisma/migrations/20260630090000_telegram_agent_entry/migration.sql`: create Telegram state tables and indexes.
- `src/lib/telegram/types.ts`: shared Telegram API and domain types.
- `src/lib/telegram/client.ts`: Telegram Bot API wrapper for `getUpdates`, `sendMessage`, and `answerCallbackQuery`.
- `src/lib/telegram/commands.ts`: parse commands and callback data; build trip switch inline keyboard.
- `src/lib/telegram/messages.ts`: format short Chinese Telegram responses and trip summaries.
- `src/lib/telegram/state.ts`: resolve bound user, store chat state, list switchable trips, switch active trip, persist offset.
- `src/lib/telegram/agent-bridge.ts`: call existing Agent planning/continuation services and load result summaries.
- `src/lib/telegram/handler.ts`: process one Telegram `message` or `callback_query`.
- `src/lib/telegram/polling.ts`: long-poll loop, offset handling, and update dispatch.
- `scripts/telegram-poll.ts`: CLI entrypoint for the worker.
- `package.json`: add `telegram:poll`.
- `docker-compose.yml`: add `telegram` service sharing env and data volume.
- `README.md`: document Telegram inbound mode and worker command.
- Tests:
  - `tests/unit/telegram-client.test.ts`
  - `tests/unit/telegram-commands.test.ts`
  - `tests/unit/telegram-polling.test.ts`
  - `tests/integration/telegram-state.test.ts`
  - `tests/integration/telegram-agent-entry.test.ts`
  - update `tests/integration/prisma-schema.test.ts`
  - update `tests/unit/docker-files.test.ts`

## Task 1: Telegram Prisma State

**Files:**
- Modify: `tests/integration/prisma-schema.test.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260630090000_telegram_agent_entry/migration.sql`

- [ ] **Step 1: Write failing schema test**

Add this test to `tests/integration/prisma-schema.test.ts`:

```ts
  it("stores Telegram chat state and bot polling offsets", () => {
    const telegramMigration = readFileSync(
      "prisma/migrations/20260630090000_telegram_agent_entry/migration.sql",
      "utf8"
    );

    for (const model of ["TelegramChatState", "TelegramBotState"]) {
      expect(schema).toContain(`model ${model}`);
    }

    expect(schema).toContain("telegramChatStates TelegramChatState[]");
    expect(schema).toContain("chatId               String   @unique");
    expect(schema).toContain("activeAgentSessionId String?");
    expect(schema).toContain("activeTripId         String?");
    expect(schema).toContain('mode                 String   @default("idle")');
    expect(schema).toContain("lastUpdateId         Int?");

    expect(telegramMigration).toContain('CREATE TABLE "TelegramChatState"');
    expect(telegramMigration).toContain('CREATE UNIQUE INDEX "TelegramChatState_chatId_key"');
    expect(telegramMigration).toContain('CREATE TABLE "TelegramBotState"');
  });
```

- [ ] **Step 2: Run schema test to verify it fails**

Run:

```bash
npm test -- tests/integration/prisma-schema.test.ts
```

Expected: FAIL because the migration file and schema models do not exist.

- [ ] **Step 3: Add Prisma models and relations**

In `prisma/schema.prisma`, add relation arrays:

```prisma
model User {
  id                 String              @id @default(cuid())
  email              String              @unique
  name               String
  passwordHash       String
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt
  sessions           Session[]
  settings           UserSettings?
  agentSessions      AgentSession[]
  trips              Trip[]
  memories           Memory[]
  memoryCandidates   MemoryCandidate[]
  telegramChatStates TelegramChatState[]
}
```

Add to `AgentSession`:

```prisma
  telegramChatStates TelegramChatState[]
```

Add to `Trip`:

```prisma
  telegramChatStates TelegramChatState[]
```

Append these models near the notification models:

```prisma
model TelegramChatState {
  id                   String        @id @default(cuid())
  chatId               String        @unique
  userId               String
  activeAgentSessionId String?
  activeTripId         String?
  mode                 String        @default("idle")
  createdAt            DateTime      @default(now())
  updatedAt            DateTime      @updatedAt
  user                 User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  activeAgentSession   AgentSession? @relation(fields: [activeAgentSessionId], references: [id], onDelete: SetNull)
  activeTrip           Trip?         @relation(fields: [activeTripId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@index([activeAgentSessionId])
  @@index([activeTripId])
  @@index([mode])
}

model TelegramBotState {
  id           String   @id
  lastUpdateId Int?
  updatedAt    DateTime @updatedAt
}
```

- [ ] **Step 4: Add migration SQL**

Create `prisma/migrations/20260630090000_telegram_agent_entry/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "TelegramChatState" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "chatId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "activeAgentSessionId" TEXT,
  "activeTripId" TEXT,
  "mode" TEXT NOT NULL DEFAULT 'idle',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TelegramChatState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TelegramChatState_activeAgentSessionId_fkey" FOREIGN KEY ("activeAgentSessionId") REFERENCES "AgentSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TelegramChatState_activeTripId_fkey" FOREIGN KEY ("activeTripId") REFERENCES "Trip" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TelegramBotState" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "lastUpdateId" INTEGER,
  "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramChatState_chatId_key" ON "TelegramChatState"("chatId");

-- CreateIndex
CREATE INDEX "TelegramChatState_userId_idx" ON "TelegramChatState"("userId");

-- CreateIndex
CREATE INDEX "TelegramChatState_activeAgentSessionId_idx" ON "TelegramChatState"("activeAgentSessionId");

-- CreateIndex
CREATE INDEX "TelegramChatState_activeTripId_idx" ON "TelegramChatState"("activeTripId");

-- CreateIndex
CREATE INDEX "TelegramChatState_mode_idx" ON "TelegramChatState"("mode");
```

- [ ] **Step 5: Run schema test and generate Prisma client**

Run:

```bash
npm run prisma:generate
npm test -- tests/integration/prisma-schema.test.ts
```

Expected: both commands PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260630090000_telegram_agent_entry/migration.sql tests/integration/prisma-schema.test.ts package-lock.json
git commit -m "feat: add telegram state models"
```

## Task 2: Telegram Bot API Client

**Files:**
- Create: `tests/unit/telegram-client.test.ts`
- Create: `src/lib/telegram/types.ts`
- Create: `src/lib/telegram/client.ts`

- [ ] **Step 1: Write failing client tests**

Create `tests/unit/telegram-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelegramBotClient, TelegramBotApiError } from "@/lib/telegram/client";

describe("Telegram Bot API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches message and callback_query updates with the next offset", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 11,
              message: { message_id: 7, chat: { id: 123 }, text: "/start" },
            },
          ],
        }),
        { status: 200 }
      )
    );
    const client = createTelegramBotClient({ token: "token" });

    const updates = await client.getUpdates({ offset: 10, timeoutSeconds: 20 });

    expect(updates).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/getUpdates",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          offset: 10,
          timeout: 20,
          allowed_updates: ["message", "callback_query"],
        }),
      })
    );
  });

  it("sends messages with inline keyboard markup", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), {
        status: 200,
      })
    );
    const client = createTelegramBotClient({ token: "token" });

    await client.sendMessage({
      chatId: "123",
      text: "选择行程",
      replyMarkup: {
        inline_keyboard: [[{ text: "切换到此行程", callback_data: "sw:trip1" }]],
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          chat_id: "123",
          text: "选择行程",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[{ text: "切换到此行程", callback_data: "sw:trip1" }]],
          },
        }),
      })
    );
  });

  it("answers callback queries", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 })
    );
    const client = createTelegramBotClient({ token: "token" });

    await client.answerCallbackQuery({
      callbackQueryId: "callback-1",
      text: "已切换",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/answerCallbackQuery",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          callback_query_id: "callback-1",
          text: "已切换",
          show_alert: false,
        }),
      })
    );
  });

  it("throws a diagnostic error for Telegram API failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: "Bad Request" }), {
        status: 400,
      })
    );
    const client = createTelegramBotClient({ token: "token" });

    await expect(client.getUpdates({ offset: 1 })).rejects.toThrow(
      TelegramBotApiError
    );
    await expect(client.getUpdates({ offset: 1 })).rejects.toThrow(
      "Telegram getUpdates 400: Bad Request"
    );
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/unit/telegram-client.test.ts
```

Expected: FAIL because `@/lib/telegram/client` does not exist.

- [ ] **Step 3: Implement shared types**

Create `src/lib/telegram/types.ts`:

```ts
export type TelegramChat = {
  id: number | string;
  type?: string;
};

export type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  text?: string;
};

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type TelegramInlineKeyboardButton = {
  text: string;
  callback_data: string;
};

export type TelegramInlineKeyboardMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

export type TelegramSendMessageInput = {
  chatId: string;
  text: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
};
```

- [ ] **Step 4: Implement client**

Create `src/lib/telegram/client.ts`:

```ts
import type {
  TelegramInlineKeyboardMarkup,
  TelegramSendMessageInput,
  TelegramUpdate,
} from "./types";

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export class TelegramBotApiError extends Error {
  constructor(method: string, status: number, description?: string) {
    super(
      description
        ? `Telegram ${method} ${status}: ${description}`
        : `Telegram ${method} request failed with ${status}`
    );
    this.name = "TelegramBotApiError";
  }
}

export type TelegramBotClient = {
  getUpdates(input: {
    offset?: number | null;
    timeoutSeconds?: number;
  }): Promise<TelegramUpdate[]>;
  sendMessage(input: TelegramSendMessageInput): Promise<void>;
  answerCallbackQuery(input: {
    callbackQueryId: string;
    text?: string;
    showAlert?: boolean;
  }): Promise<void>;
};

export function createTelegramBotClient(input: { token: string }): TelegramBotClient {
  const baseUrl = `https://api.telegram.org/bot${input.token}`;

  async function request<T>(method: string, body: Record<string, unknown>) {
    const response = await fetch(`${baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | TelegramApiResponse<T>
      | null;

    if (!response.ok || !payload?.ok) {
      throw new TelegramBotApiError(
        method,
        response.status,
        payload?.description
      );
    }

    return payload.result as T;
  }

  return {
    getUpdates({ offset, timeoutSeconds = 30 }) {
      return request<TelegramUpdate[]>("getUpdates", {
        offset: offset ?? undefined,
        timeout: timeoutSeconds,
        allowed_updates: ["message", "callback_query"],
      });
    },
    async sendMessage({ chatId, text, replyMarkup }) {
      await request("sendMessage", {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        reply_markup: replyMarkup,
      });
    },
    async answerCallbackQuery({ callbackQueryId, text, showAlert = false }) {
      await request("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      });
    },
  };
}

export type { TelegramInlineKeyboardMarkup };
```

- [ ] **Step 5: Run client tests**

Run:

```bash
npm test -- tests/unit/telegram-client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/telegram/types.ts src/lib/telegram/client.ts tests/unit/telegram-client.test.ts
git commit -m "feat: add telegram bot api client"
```

## Task 3: Commands, Callback Data, and Telegram Message Formatting

**Files:**
- Create: `tests/unit/telegram-commands.test.ts`
- Create: `src/lib/telegram/commands.ts`
- Create: `src/lib/telegram/messages.ts`

- [ ] **Step 1: Write failing command tests**

Create `tests/unit/telegram-commands.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildTripSwitchKeyboard,
  parseTelegramCallbackData,
  parseTelegramCommand,
} from "@/lib/telegram/commands";
import {
  formatBoundHelpMessage,
  formatTripListMessage,
  formatTripSummaryLine,
} from "@/lib/telegram/messages";

describe("Telegram command parsing", () => {
  it("parses commands and command payloads", () => {
    expect(parseTelegramCommand("/start")).toEqual({ kind: "start" });
    expect(parseTelegramCommand("/new")).toEqual({ kind: "new", prompt: "" });
    expect(parseTelegramCommand("/new 明天九点到外事学校")).toEqual({
      kind: "new",
      prompt: "明天九点到外事学校",
    });
    expect(parseTelegramCommand("/trips")).toEqual({ kind: "trips" });
    expect(parseTelegramCommand("/status")).toEqual({ kind: "status" });
    expect(parseTelegramCommand("/cancel")).toEqual({ kind: "cancel" });
    expect(parseTelegramCommand("明天九点到外事学校")).toEqual({
      kind: "plain_text",
      text: "明天九点到外事学校",
    });
  });

  it("ignores bot username suffixes in commands", () => {
    expect(parseTelegramCommand("/new@CommutePlannerBot 明早到学校")).toEqual({
      kind: "new",
      prompt: "明早到学校",
    });
  });

  it("parses trip switch callback data", () => {
    expect(parseTelegramCallbackData("sw:trip_123")).toEqual({
      kind: "switch_trip",
      tripId: "trip_123",
    });
    expect(parseTelegramCallbackData("bad:trip_123")).toEqual({
      kind: "unknown",
    });
  });

  it("builds compact inline keyboards for trip switching", () => {
    const keyboard = buildTripSwitchKeyboard([
      { id: "trip_123", title: "家-外事学校" },
      { id: "trip_456", title: "家-天街" },
    ]);

    expect(keyboard.inline_keyboard).toEqual([
      [{ text: "切换到此行程：家-外事学校", callback_data: "sw:trip_123" }],
      [{ text: "切换到此行程：家-天街", callback_data: "sw:trip_456" }],
    ]);
    for (const row of keyboard.inline_keyboard) {
      expect(Buffer.byteLength(row[0].callback_data, "utf8")).toBeLessThanOrEqual(64);
    }
  });

  it("formats short Chinese messages", () => {
    expect(formatBoundHelpMessage({ hasActiveTrip: true })).toContain("/trips");
    expect(formatTripSummaryLine({
      title: "家-外事学校",
      status: "monitoring",
      scheduledReminderCount: 3,
      targetArriveAt: new Date("2026-07-01T01:00:00.000Z"),
    })).toContain("家-外事学校");
    expect(formatTripListMessage([])).toBe("最近没有可切换的行程。");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/unit/telegram-commands.test.ts
```

Expected: FAIL because command modules do not exist.

- [ ] **Step 3: Implement commands**

Create `src/lib/telegram/commands.ts`:

```ts
import type { TelegramInlineKeyboardMarkup } from "./types";

export type TelegramCommand =
  | { kind: "start" }
  | { kind: "new"; prompt: string }
  | { kind: "trips" }
  | { kind: "status" }
  | { kind: "cancel" }
  | { kind: "plain_text"; text: string }
  | { kind: "unknown"; text: string };

export type TelegramCallbackAction =
  | { kind: "switch_trip"; tripId: string }
  | { kind: "unknown" };

export type TripSwitchButtonInput = {
  id: string;
  title: string;
};

function stripBotSuffix(command: string) {
  return command.replace(/@[\w_]+$/i, "");
}

export function parseTelegramCommand(text: string): TelegramCommand {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return { kind: "plain_text", text: trimmed };
  }

  const [rawCommand, ...rest] = trimmed.split(/\s+/);
  const command = stripBotSuffix(rawCommand).toLowerCase();
  const payload = rest.join(" ").trim();

  if (command === "/start") return { kind: "start" };
  if (command === "/new") return { kind: "new", prompt: payload };
  if (command === "/trips") return { kind: "trips" };
  if (command === "/status") return { kind: "status" };
  if (command === "/cancel") return { kind: "cancel" };
  return { kind: "unknown", text: trimmed };
}

export function parseTelegramCallbackData(data?: string): TelegramCallbackAction {
  if (!data) return { kind: "unknown" };
  if (data.startsWith("sw:")) {
    const tripId = data.slice(3).trim();
    return tripId ? { kind: "switch_trip", tripId } : { kind: "unknown" };
  }
  return { kind: "unknown" };
}

export function buildTripSwitchKeyboard(
  trips: TripSwitchButtonInput[]
): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: trips.map((trip) => {
      const callbackData = `sw:${trip.id}`;
      if (Buffer.byteLength(callbackData, "utf8") > 64) {
        throw new Error("Telegram callback_data exceeds 64 bytes.");
      }
      return [
        {
          text: `切换到此行程：${trip.title}`,
          callback_data: callbackData,
        },
      ];
    }),
  };
}
```

- [ ] **Step 4: Implement message formatting**

Create `src/lib/telegram/messages.ts`:

```ts
export type TelegramTripSummary = {
  title: string;
  status: string;
  scheduledReminderCount: number;
  targetArriveAt?: Date | null;
};

function formatBeijingTime(date?: Date | null) {
  if (!date) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatBoundHelpMessage(input: { hasActiveTrip: boolean }) {
  const active = input.hasActiveTrip
    ? "当前已有绑定行程，直接发消息即可继续和 Agent 对话。"
    : "当前没有绑定行程，发送 /new 加出行需求即可开始。";

  return [
    "通勤规划助手已连接。",
    active,
    "可用命令：",
    "/new 明天九点到外事学校",
    "/trips 切换当前行程",
    "/status 查看当前行程",
    "/cancel 取消当前行程监控",
  ].join("\n");
}

export function formatTripSummaryLine(input: TelegramTripSummary) {
  return [
    input.title,
    `状态：${input.status}`,
    `目标到达：${formatBeijingTime(input.targetArriveAt)}`,
    `待提醒：${input.scheduledReminderCount}`,
  ].join("｜");
}

export function formatTripListMessage(trips: TelegramTripSummary[]) {
  if (trips.length === 0) {
    return "最近没有可切换的行程。";
  }

  return ["请选择要继续对话的行程：", ...trips.map(formatTripSummaryLine)].join(
    "\n"
  );
}

export function formatUnboundMessage(chatId: string) {
  return `请先在网站设置页填写 Telegram Chat ID: ${chatId}`;
}
```

- [ ] **Step 5: Run command tests**

Run:

```bash
npm test -- tests/unit/telegram-commands.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/telegram/commands.ts src/lib/telegram/messages.ts tests/unit/telegram-commands.test.ts
git commit -m "feat: add telegram command parsing"
```

## Task 4: Telegram Binding and State Service

**Files:**
- Create: `tests/integration/telegram-state.test.ts`
- Create: `src/lib/telegram/state.ts`

- [ ] **Step 1: Write failing state integration tests**

Create `tests/integration/telegram-state.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  findBoundTelegramUser,
  getNextTelegramOffset,
  listSwitchableTrips,
  markTelegramUpdateProcessed,
  setTelegramAwaitingNewPrompt,
  switchTelegramActiveTrip,
} from "@/lib/telegram/state";
import { createPlannedTrip } from "@/lib/trips/create-trip";
import { ensureTestDatabase } from "./test-db";

describe("telegram state service", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  it("resolves unbound, bound, and ambiguous chat ids", async () => {
    const chatId = `chat-${Date.now()}`;
    await expect(findBoundTelegramUser(chatId)).resolves.toMatchObject({
      status: "unbound",
      chatId,
    });

    const user = await createTelegramUser("bound", chatId);
    await expect(findBoundTelegramUser(chatId)).resolves.toMatchObject({
      status: "bound",
      chatId,
      user: { id: user.id },
    });

    await createTelegramUser("ambiguous", chatId);
    await expect(findBoundTelegramUser(chatId)).resolves.toMatchObject({
      status: "ambiguous",
      chatId,
    });
  });

  it("stores awaiting new prompt state", async () => {
    const chatId = `awaiting-${Date.now()}`;
    const user = await createTelegramUser("awaiting", chatId);

    const state = await setTelegramAwaitingNewPrompt({ chatId, userId: user.id });

    expect(state).toMatchObject({
      chatId,
      userId: user.id,
      mode: "awaiting_new_prompt",
      activeAgentSessionId: null,
      activeTripId: null,
    });
  });

  it("lists switchable trips with monitoring trips first", async () => {
    const chatId = `trips-${Date.now()}`;
    const user = await createTelegramUser("trips", chatId);
    const monitoring = await createTrip(user.id, "家-外事学校", "monitoring");
    await createTrip(user.id, "家-取消", "cancelled");
    const completed = await createTrip(user.id, "家-天街", "completed");

    const trips = await listSwitchableTrips({ userId: user.id });

    expect(trips.map((trip) => trip.id)).toEqual([
      monitoring.id,
      completed.id,
    ]);
    expect(trips[0]).toMatchObject({
      title: "家-外事学校",
      scheduledReminderCount: expect.any(Number),
    });
  });

  it("switches active trip and bootstraps an agent session when needed", async () => {
    const chatId = `switch-${Date.now()}`;
    const user = await createTelegramUser("switch", chatId);
    const trip = await createTrip(user.id, "家-图书馆", "monitoring");

    const result = await switchTelegramActiveTrip({
      chatId,
      userId: user.id,
      tripId: trip.id,
    });

    expect(result).toMatchObject({
      status: "switched",
      trip: { id: trip.id, title: "家-图书馆" },
      agentSessionId: expect.any(String),
    });
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      activeTripId: trip.id,
      activeAgentSessionId: result.agentSessionId,
      mode: "active",
    });
  });

  it("stores and returns the next Telegram offset", async () => {
    await markTelegramUpdateProcessed(42);
    await expect(getNextTelegramOffset()).resolves.toBe(43);
  });
});

async function createTelegramUser(label: string, chatId: string) {
  return prisma.user.create({
    data: {
      email: `${label}-${Date.now()}-${Math.random()}@example.com`,
      name: label,
      passwordHash: "hash",
      settings: {
        create: {
          defaultCity: "宁波",
          timezone: "Asia/Shanghai",
          originName: "家",
          originLngLat: "121.1,29.1",
          routePreference: "balanced",
          telegramChatId: chatId,
        },
      },
    },
  });
}

async function createTrip(userId: string, title: string, status: string) {
  const trip = await createPlannedTrip({
    userId,
    rawPrompt: title,
    timezone: "Asia/Shanghai",
    title,
    finalStopName: title.split("-").at(-1),
    targetArriveAt: new Date("2026-07-01T01:00:00.000Z"),
    stops: [{ order: 1, name: title.split("-").at(-1) ?? title }],
    legs: [
      {
        order: 1,
        originName: "家",
        originLngLat: "121.1,29.1",
        destinationName: title.split("-").at(-1) ?? title,
        destinationLngLat: "121.2,29.2",
        routeMinutes: 20,
        bufferComponents: [
          {
            category: "transfer",
            label: "换乘",
            minutes: 5,
            reason: "预留换乘时间。",
          },
        ],
      },
    ],
  });

  return prisma.trip.update({ where: { id: trip.id }, data: { status } });
}
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- tests/integration/telegram-state.test.ts
```

Expected: FAIL because `src/lib/telegram/state.ts` does not exist.

- [ ] **Step 3: Implement binding and state service**

Create `src/lib/telegram/state.ts`:

```ts
import { prisma } from "@/lib/db";

export type BoundTelegramUserResult =
  | { status: "unbound"; chatId: string }
  | { status: "ambiguous"; chatId: string }
  | { status: "bound"; chatId: string; user: { id: string } };

export async function findBoundTelegramUser(
  chatId: string
): Promise<BoundTelegramUserResult> {
  const settings = await prisma.userSettings.findMany({
    where: { telegramChatId: chatId },
    select: { userId: true },
    take: 2,
  });

  if (settings.length === 0) return { status: "unbound", chatId };
  if (settings.length > 1) return { status: "ambiguous", chatId };
  return { status: "bound", chatId, user: { id: settings[0].userId } };
}

export async function setTelegramAwaitingNewPrompt(input: {
  chatId: string;
  userId: string;
}) {
  return prisma.telegramChatState.upsert({
    where: { chatId: input.chatId },
    create: {
      chatId: input.chatId,
      userId: input.userId,
      activeAgentSessionId: null,
      activeTripId: null,
      mode: "awaiting_new_prompt",
    },
    update: {
      userId: input.userId,
      activeAgentSessionId: null,
      activeTripId: null,
      mode: "awaiting_new_prompt",
    },
  });
}

export async function setTelegramActiveConversation(input: {
  chatId: string;
  userId: string;
  agentSessionId: string;
  tripId?: string | null;
}) {
  return prisma.telegramChatState.upsert({
    where: { chatId: input.chatId },
    create: {
      chatId: input.chatId,
      userId: input.userId,
      activeAgentSessionId: input.agentSessionId,
      activeTripId: input.tripId ?? null,
      mode: "active",
    },
    update: {
      userId: input.userId,
      activeAgentSessionId: input.agentSessionId,
      activeTripId: input.tripId ?? null,
      mode: "active",
    },
  });
}

export async function getTelegramChatState(chatId: string) {
  return prisma.telegramChatState.findUnique({ where: { chatId } });
}

export async function listSwitchableTrips(input: { userId: string }) {
  const trips = await prisma.trip.findMany({
    where: {
      userId: input.userId,
      status: { not: "cancelled" },
    },
    orderBy: [{ status: "desc" }, { createdAt: "desc" }],
    take: 10,
    include: {
      reminderJobs: {
        where: { status: "scheduled" },
        select: { id: true },
      },
    },
  });

  return trips
    .sort((left, right) => {
      if (left.status === "monitoring" && right.status !== "monitoring") return -1;
      if (left.status !== "monitoring" && right.status === "monitoring") return 1;
      return right.createdAt.getTime() - left.createdAt.getTime();
    })
    .map((trip) => ({
      id: trip.id,
      title: trip.title,
      status: trip.status,
      targetArriveAt: trip.targetArriveAt,
      scheduledReminderCount: trip.reminderJobs.length,
    }));
}

async function findOrCreateTripAgentSession(input: {
  userId: string;
  tripId: string;
  tripTitle: string;
  tripAgentSessionId?: string | null;
}) {
  if (input.tripAgentSessionId) {
    const byTripScalar = await prisma.agentSession.findFirst({
      where: { id: input.tripAgentSessionId, userId: input.userId },
      orderBy: { createdAt: "desc" },
    });
    if (byTripScalar) return byTripScalar;
  }

  const existing = await prisma.agentSession.findFirst({
    where: { userId: input.userId, tripId: input.tripId },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  return prisma.agentSession.create({
    data: {
      userId: input.userId,
      tripId: input.tripId,
      status: "completed",
      purpose: "telegram_continuation",
      prompt: `Telegram 选择已有行程继续对话：${input.tripTitle}`,
      messages: {
        create: {
          role: "assistant",
          content: "已从 Telegram 绑定到已有行程。",
        },
      },
    },
  });
}

export async function switchTelegramActiveTrip(input: {
  chatId: string;
  userId: string;
  tripId: string;
}) {
  const trip = await prisma.trip.findFirst({
    where: {
      id: input.tripId,
      userId: input.userId,
      status: { not: "cancelled" },
    },
  });

  if (!trip) {
    return { status: "not_found" as const };
  }

  const session = await findOrCreateTripAgentSession({
    userId: input.userId,
    tripId: trip.id,
    tripTitle: trip.title,
    tripAgentSessionId: trip.agentSessionId,
  });

  await setTelegramActiveConversation({
    chatId: input.chatId,
    userId: input.userId,
    agentSessionId: session.id,
    tripId: trip.id,
  });

  return {
    status: "switched" as const,
    trip: { id: trip.id, title: trip.title },
    agentSessionId: session.id,
  };
}

export async function getNextTelegramOffset() {
  const state = await prisma.telegramBotState.findUnique({
    where: { id: "default" },
  });
  return state.lastUpdateId === null || state.lastUpdateId === undefined
    ? undefined
    : state.lastUpdateId + 1;
}

export async function markTelegramUpdateProcessed(updateId: number) {
  return prisma.telegramBotState.upsert({
    where: { id: "default" },
    create: { id: "default", lastUpdateId: updateId },
    update: { lastUpdateId: updateId },
  });
}
```

- [ ] **Step 4: Run state tests**

Run:

```bash
npm test -- tests/integration/telegram-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/telegram/state.ts tests/integration/telegram-state.test.ts
git commit -m "feat: add telegram chat state service"
```

## Task 5: Agent Bridge and Update Handler

**Files:**
- Create: `tests/integration/telegram-agent-entry.test.ts`
- Create: `src/lib/telegram/agent-bridge.ts`
- Create: `src/lib/telegram/handler.ts`

- [ ] **Step 1: Write failing handler integration tests**

Create `tests/integration/telegram-agent-entry.test.ts`:

```ts
import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { handleTelegramUpdate } from "@/lib/telegram/handler";
import type { TelegramBotClient } from "@/lib/telegram/client";
import { ensureTestDatabase } from "./test-db";

describe("telegram agent entry handler", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  it("asks unbound chats to save their Telegram Chat ID", async () => {
    const bot = createBotMock();

    await handleTelegramUpdate({
      update: messageUpdate(1, "unbound-chat", "/start"),
      bot,
      agentBridge: createAgentBridgeMock(),
    });

    expect(bot.sendMessage).toHaveBeenCalledWith({
      chatId: "unbound-chat",
      text: "请先在网站设置页填写 Telegram Chat ID: unbound-chat",
    });
  });

  it("handles /new prompt as a new planning session", async () => {
    const chatId = `new-${Date.now()}`;
    const user = await createTelegramUser("new", chatId);
    const bot = createBotMock();
    const agentBridge = createAgentBridgeMock({
      startPlanning: vi.fn().mockResolvedValue({
        sessionId: "session-new",
        tripId: "trip-new",
        summary: "已创建行程：家-外事学校",
      }),
    });

    await handleTelegramUpdate({
      update: messageUpdate(2, chatId, "/new 明天九点到外事学校"),
      bot,
      agentBridge,
    });

    expect(agentBridge.startPlanning).toHaveBeenCalledWith({
      userId: user.id,
      prompt: "明天九点到外事学校",
    });
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      activeAgentSessionId: "session-new",
      activeTripId: "trip-new",
      mode: "active",
    });
    expect(bot.sendMessage).toHaveBeenCalledWith({
      chatId,
      text: "已开始规划，我来处理。",
    });
    expect(bot.sendMessage).toHaveBeenCalledWith({
      chatId,
      text: "已创建行程：家-外事学校",
    });
  });

  it("stores /new without prompt as awaiting next text", async () => {
    const chatId = `await-${Date.now()}`;
    const user = await createTelegramUser("await", chatId);
    const bot = createBotMock();

    await handleTelegramUpdate({
      update: messageUpdate(3, chatId, "/new"),
      bot,
      agentBridge: createAgentBridgeMock(),
    });

    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      userId: user.id,
      mode: "awaiting_new_prompt",
    });
  });

  it("continues the active agent session for plain text", async () => {
    const chatId = `continue-${Date.now()}`;
    const user = await createTelegramUser("continue", chatId);
    await prisma.agentSession.create({
      data: {
        id: "session-active-continue",
        userId: user.id,
        status: "completed",
        purpose: "planning",
        prompt: "初始行程",
      },
    });
    await prisma.telegramChatState.create({
      data: {
        chatId,
        userId: user.id,
        activeAgentSessionId: "session-active-continue",
        mode: "active",
      },
    });
    const bot = createBotMock();
    const agentBridge = createAgentBridgeMock({
      continueSession: vi.fn().mockResolvedValue({
        sessionId: "session-active-continue",
        tripId: "trip-updated",
        summary: "已更新当前行程。",
      }),
    });

    await handleTelegramUpdate({
      update: messageUpdate(4, chatId, "改成地铁优先"),
      bot,
      agentBridge,
    });

    expect(agentBridge.continueSession).toHaveBeenCalledWith({
      userId: user.id,
      sessionId: "session-active-continue",
      message: "改成地铁优先",
    });
  });

  it("rejects plain text while the active agent session is running", async () => {
    const chatId = `running-${Date.now()}`;
    const user = await createTelegramUser("running", chatId);
    await prisma.agentSession.create({
      data: {
        id: "session-running",
        userId: user.id,
        status: "running",
        purpose: "planning",
        prompt: "正在运行",
      },
    });
    await prisma.telegramChatState.create({
      data: {
        chatId,
        userId: user.id,
        activeAgentSessionId: "session-running",
        mode: "active",
      },
    });
    const bot = createBotMock();

    await handleTelegramUpdate({
      update: messageUpdate(5, chatId, "第二条"),
      bot,
      agentBridge: createAgentBridgeMock(),
    });

    expect(bot.sendMessage).toHaveBeenCalledWith({
      chatId,
      text: "智能体还在处理，请稍后再发送新的消息。",
    });
  });

  it("lists trips with inline switch buttons", async () => {
    const chatId = `list-${Date.now()}`;
    const user = await createTelegramUser("list", chatId);
    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        title: "家-外事学校",
        rawPrompt: "去学校",
        timezone: "Asia/Shanghai",
        status: "monitoring",
      },
    });
    const bot = createBotMock();

    await handleTelegramUpdate({
      update: messageUpdate(6, chatId, "/trips"),
      bot,
      agentBridge: createAgentBridgeMock(),
    });

    expect(bot.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId,
        replyMarkup: {
          inline_keyboard: [
            [
              {
                text: "切换到此行程：家-外事学校",
                callback_data: `sw:${trip.id}`,
              },
            ],
          ],
        },
      })
    );
  });

  it("switches current trip from inline callback", async () => {
    const chatId = `callback-${Date.now()}`;
    const user = await createTelegramUser("callback", chatId);
    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        title: "家-天街",
        rawPrompt: "去天街",
        timezone: "Asia/Shanghai",
        status: "monitoring",
      },
    });
    const bot = createBotMock();

    await handleTelegramUpdate({
      update: callbackUpdate(7, chatId, "callback-7", `sw:${trip.id}`),
      bot,
      agentBridge: createAgentBridgeMock(),
    });

    expect(bot.answerCallbackQuery).toHaveBeenCalledWith({
      callbackQueryId: "callback-7",
      text: "已切换到：家-天街",
    });
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      activeTripId: trip.id,
      mode: "active",
    });
  });
});

function messageUpdate(updateId: number, chatId: string, text: string) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      chat: { id: chatId },
      text,
    },
  };
}

function callbackUpdate(
  updateId: number,
  chatId: string,
  callbackQueryId: string,
  data: string
) {
  return {
    update_id: updateId,
    callback_query: {
      id: callbackQueryId,
      data,
      message: {
        message_id: updateId,
        chat: { id: chatId },
      },
    },
  };
}

function createBotMock(): TelegramBotClient {
  return {
    getUpdates: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  };
}

function createAgentBridgeMock(overrides = {}) {
  return {
    startPlanning: vi.fn().mockResolvedValue({
      sessionId: "session",
      tripId: "trip",
      summary: "规划完成。",
    }),
    continueSession: vi.fn().mockResolvedValue({
      sessionId: "session",
      tripId: "trip",
      summary: "续聊完成。",
    }),
    ...overrides,
  };
}

async function createTelegramUser(label: string, chatId: string) {
  return prisma.user.create({
    data: {
      email: `${label}-${Date.now()}-${Math.random()}@example.com`,
      name: label,
      passwordHash: "hash",
      settings: {
        create: {
          defaultCity: "宁波",
          timezone: "Asia/Shanghai",
          originName: "家",
          originLngLat: "121.1,29.1",
          routePreference: "balanced",
          telegramChatId: chatId,
        },
      },
    },
  });
}
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- tests/integration/telegram-agent-entry.test.ts
```

Expected: FAIL because handler and bridge modules do not exist.

- [ ] **Step 3: Implement Agent bridge**

Create `src/lib/telegram/agent-bridge.ts`:

```ts
import {
  acceptAgentSessionMessage,
  runAcceptedContinuationSession,
  runPlanningSession,
  startPlanningSession,
} from "@/lib/agent/planner";
import { prisma } from "@/lib/db";

export type TelegramAgentBridge = {
  startPlanning(input: {
    userId: string;
    prompt: string;
  }): Promise<{ sessionId: string; tripId: string | null; summary: string }>;
  continueSession(input: {
    userId: string;
    sessionId: string;
    message: string;
  }): Promise<{ sessionId: string; tripId: string | null; summary: string }>;
};

async function latestAssistantMessage(sessionId: string) {
  const message = await prisma.agentMessage.findFirst({
    where: { agentSessionId: sessionId, role: "assistant" },
    orderBy: { createdAt: "desc" },
  });
  return message?.content ?? "智能体处理完成。";
}

export function createTelegramAgentBridge(): TelegramAgentBridge {
  return {
    async startPlanning({ userId, prompt }) {
      const session = await startPlanningSession({ userId, prompt });
      const result = await runPlanningSession(session.id);
      return {
        sessionId: session.id,
        tripId: result.tripId,
        summary: await latestAssistantMessage(session.id),
      };
    },
    async continueSession({ userId, sessionId, message }) {
      await acceptAgentSessionMessage({ userId, sessionId, message });
      const result = await runAcceptedContinuationSession(sessionId);
      return {
        sessionId,
        tripId: result.tripId,
        summary: await latestAssistantMessage(sessionId),
      };
    },
  };
}
```

- [ ] **Step 4: Implement handler**

Create `src/lib/telegram/handler.ts`:

```ts
import { cancelTripMonitoring } from "@/lib/trips/monitoring";
import { prisma } from "@/lib/db";
import type { TelegramBotClient } from "./client";
import {
  buildTripSwitchKeyboard,
  parseTelegramCallbackData,
  parseTelegramCommand,
} from "./commands";
import { createTelegramAgentBridge, type TelegramAgentBridge } from "./agent-bridge";
import {
  findBoundTelegramUser,
  getTelegramChatState,
  listSwitchableTrips,
  setTelegramActiveConversation,
  setTelegramAwaitingNewPrompt,
  switchTelegramActiveTrip,
} from "./state";
import {
  formatBoundHelpMessage,
  formatTripListMessage,
  formatUnboundMessage,
} from "./messages";
import type { TelegramUpdate } from "./types";

export type HandleTelegramUpdateInput = {
  update: TelegramUpdate;
  bot: TelegramBotClient;
  agentBridge?: TelegramAgentBridge;
};

function chatIdToString(value: number | string) {
  return String(value);
}

async function resolveBoundUser(chatId: string, bot: TelegramBotClient) {
  const bound = await findBoundTelegramUser(chatId);
  if (bound.status === "unbound") {
    await bot.sendMessage({ chatId, text: formatUnboundMessage(chatId) });
    return null;
  }
  if (bound.status === "ambiguous") {
    await bot.sendMessage({
      chatId,
      text: "多个用户绑定了同一个 Telegram Chat ID，请先在网站设置页修正。",
    });
    return null;
  }
  return bound.user;
}

async function startNewPlanning(input: {
  chatId: string;
  userId: string;
  prompt: string;
  bot: TelegramBotClient;
  agentBridge: TelegramAgentBridge;
}) {
  await input.bot.sendMessage({
    chatId: input.chatId,
    text: "已开始规划，我来处理。",
  });
  const result = await input.agentBridge.startPlanning({
    userId: input.userId,
    prompt: input.prompt,
  });
  await setTelegramActiveConversation({
    chatId: input.chatId,
    userId: input.userId,
    agentSessionId: result.sessionId,
    tripId: result.tripId,
  });
  await input.bot.sendMessage({ chatId: input.chatId, text: result.summary });
}

async function continueActiveSession(input: {
  chatId: string;
  userId: string;
  message: string;
  bot: TelegramBotClient;
  agentBridge: TelegramAgentBridge;
}) {
  const state = await getTelegramChatState(input.chatId);
  const activeSessionId = state?.activeAgentSessionId;

  if (!activeSessionId) {
    return startNewPlanning({
      chatId: input.chatId,
      userId: input.userId,
      prompt: input.message,
      bot: input.bot,
      agentBridge: input.agentBridge,
    });
  }

  const session = await prisma.agentSession.findFirst({
    where: { id: activeSessionId, userId: input.userId },
  });

  if (!session) {
    return startNewPlanning({
      chatId: input.chatId,
      userId: input.userId,
      prompt: input.message,
      bot: input.bot,
      agentBridge: input.agentBridge,
    });
  }

  if (session.status === "running") {
    await input.bot.sendMessage({
      chatId: input.chatId,
      text: "智能体还在处理，请稍后再发送新的消息。",
    });
    return;
  }

  await input.bot.sendMessage({ chatId: input.chatId, text: "收到，我继续处理。" });
  const result = await input.agentBridge.continueSession({
    userId: input.userId,
    sessionId: session.id,
    message: input.message,
  });
  await setTelegramActiveConversation({
    chatId: input.chatId,
    userId: input.userId,
    agentSessionId: session.id,
    tripId: result.tripId ?? state?.activeTripId,
  });
  await input.bot.sendMessage({ chatId: input.chatId, text: result.summary });
}

async function handleMessage(input: Required<HandleTelegramUpdateInput>) {
  const message = input.update.message;
  if (!message) return;
  const chatId = chatIdToString(message.chat.id);
  const user = await resolveBoundUser(chatId, input.bot);
  if (!user) return;

  if (!message.text?.trim()) {
    await input.bot.sendMessage({
      chatId,
      text: "当前只支持文本规划和命令。",
    });
    return;
  }

  const command = parseTelegramCommand(message.text);

  if (command.kind === "start") {
    const state = await getTelegramChatState(chatId);
    await input.bot.sendMessage({
      chatId,
      text: formatBoundHelpMessage({ hasActiveTrip: Boolean(state?.activeTripId) }),
    });
    return;
  }

  if (command.kind === "new" && !command.prompt) {
    await setTelegramAwaitingNewPrompt({ chatId, userId: user.id });
    await input.bot.sendMessage({
      chatId,
      text: "请发送新的出行需求，例如：明天九点到外事学校。",
    });
    return;
  }

  if (command.kind === "new" && command.prompt) {
    await startNewPlanning({
      chatId,
      userId: user.id,
      prompt: command.prompt,
      bot: input.bot,
      agentBridge: input.agentBridge,
    });
    return;
  }

  if (command.kind === "trips") {
    const trips = await listSwitchableTrips({ userId: user.id });
    await input.bot.sendMessage({
      chatId,
      text: formatTripListMessage(trips),
      replyMarkup: trips.length
        ? buildTripSwitchKeyboard(trips.map((trip) => ({ id: trip.id, title: trip.title })))
        : undefined,
    });
    return;
  }

  if (command.kind === "cancel") {
    const state = await getTelegramChatState(chatId);
    if (!state?.activeTripId) {
      await input.bot.sendMessage({ chatId, text: "当前没有可取消监控的行程。" });
      return;
    }
    await cancelTripMonitoring({ tripId: state.activeTripId, userId: user.id });
    await input.bot.sendMessage({ chatId, text: "已取消当前行程监控。" });
    return;
  }

  if (command.kind === "status") {
    const state = await getTelegramChatState(chatId);
    await input.bot.sendMessage({
      chatId,
      text: state?.activeTripId
        ? `当前行程：${state.activeTripId}`
        : "当前没有绑定行程。发送 /new 开始规划。",
    });
    return;
  }

  if (command.kind === "plain_text") {
    const state = await getTelegramChatState(chatId);
    if (state?.mode === "awaiting_new_prompt" || !state?.activeAgentSessionId) {
      await startNewPlanning({
        chatId,
        userId: user.id,
        prompt: command.text,
        bot: input.bot,
        agentBridge: input.agentBridge,
      });
      return;
    }
    await continueActiveSession({
      chatId,
      userId: user.id,
      message: command.text,
      bot: input.bot,
      agentBridge: input.agentBridge,
    });
    return;
  }

  await input.bot.sendMessage({ chatId, text: "不支持该命令。发送 /start 查看帮助。" });
}

async function handleCallback(input: Required<HandleTelegramUpdateInput>) {
  const callback = input.update.callback_query;
  if (!callback?.message) return;
  const chatId = chatIdToString(callback.message.chat.id);
  const user = await resolveBoundUser(chatId, input.bot);
  if (!user) return;
  const action = parseTelegramCallbackData(callback.data);

  if (action.kind !== "switch_trip") {
    await input.bot.answerCallbackQuery({
      callbackQueryId: callback.id,
      text: "这个按钮已不可用。",
    });
    return;
  }

  const result = await switchTelegramActiveTrip({
    chatId,
    userId: user.id,
    tripId: action.tripId,
  });

  if (result.status !== "switched") {
    await input.bot.answerCallbackQuery({
      callbackQueryId: callback.id,
      text: "这个行程已不可切换。",
    });
    return;
  }

  await input.bot.answerCallbackQuery({
    callbackQueryId: callback.id,
    text: `已切换到：${result.trip.title}`,
  });
  await input.bot.sendMessage({
    chatId,
    text: `已切换到：${result.trip.title}\n后续普通消息会继续和这个行程的 Agent 对话。`,
  });
}

export async function handleTelegramUpdate(input: HandleTelegramUpdateInput) {
  const fullInput = {
    ...input,
    agentBridge: input.agentBridge ?? createTelegramAgentBridge(),
  };

  if (input.update.message) {
    await handleMessage(fullInput);
    return;
  }

  if (input.update.callback_query) {
    await handleCallback(fullInput);
  }
}
```

- [ ] **Step 5: Run handler tests**

Run:

```bash
npm test -- tests/integration/telegram-agent-entry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/telegram/agent-bridge.ts src/lib/telegram/handler.ts tests/integration/telegram-agent-entry.test.ts
git commit -m "feat: route telegram updates to agent sessions"
```

## Task 6: Long Polling Worker

**Files:**
- Create: `tests/unit/telegram-polling.test.ts`
- Create: `src/lib/telegram/polling.ts`
- Create: `scripts/telegram-poll.ts`

- [ ] **Step 1: Write failing polling tests**

Create `tests/unit/telegram-polling.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { processTelegramPollingBatch } from "@/lib/telegram/polling";
import type { TelegramBotClient } from "@/lib/telegram/client";

describe("telegram polling", () => {
  it("fetches updates from the current offset and marks each processed update", async () => {
    const bot: TelegramBotClient = {
      getUpdates: vi.fn().mockResolvedValue([
        { update_id: 10, message: { message_id: 1, chat: { id: "chat" }, text: "/start" } },
        { update_id: 11, message: { message_id: 2, chat: { id: "chat" }, text: "/status" } },
      ]),
      sendMessage: vi.fn(),
      answerCallbackQuery: vi.fn(),
    };
    const handler = vi.fn().mockResolvedValue(undefined);
    const markProcessed = vi.fn().mockResolvedValue(undefined);

    const processed = await processTelegramPollingBatch({
      bot,
      offset: 10,
      timeoutSeconds: 1,
      handleUpdate: handler,
      markProcessed,
    });

    expect(processed).toBe(2);
    expect(bot.getUpdates).toHaveBeenCalledWith({
      offset: 10,
      timeoutSeconds: 1,
    });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(markProcessed).toHaveBeenCalledWith(10);
    expect(markProcessed).toHaveBeenCalledWith(11);
  });

  it("does not mark an update processed when its handler fails", async () => {
    const bot: TelegramBotClient = {
      getUpdates: vi.fn().mockResolvedValue([
        { update_id: 12, message: { message_id: 1, chat: { id: "chat" }, text: "/start" } },
      ]),
      sendMessage: vi.fn(),
      answerCallbackQuery: vi.fn(),
    };

    await expect(
      processTelegramPollingBatch({
        bot,
        offset: 12,
        timeoutSeconds: 1,
        handleUpdate: vi.fn().mockRejectedValue(new Error("handler failed")),
        markProcessed: vi.fn(),
      })
    ).rejects.toThrow("handler failed");
  });
});
```

- [ ] **Step 2: Run polling test to verify failure**

Run:

```bash
npm test -- tests/unit/telegram-polling.test.ts
```

Expected: FAIL because polling module does not exist.

- [ ] **Step 3: Implement polling helpers**

Create `src/lib/telegram/polling.ts`:

```ts
import { createTelegramBotClient, type TelegramBotClient } from "./client";
import { handleTelegramUpdate } from "./handler";
import {
  getNextTelegramOffset,
  markTelegramUpdateProcessed,
} from "./state";
import type { TelegramUpdate } from "./types";

export type ProcessTelegramPollingBatchInput = {
  bot: TelegramBotClient;
  offset?: number;
  timeoutSeconds: number;
  handleUpdate(update: TelegramUpdate): Promise<void>;
  markProcessed(updateId: number): Promise<unknown>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function processTelegramPollingBatch({
  bot,
  offset,
  timeoutSeconds,
  handleUpdate,
  markProcessed,
}: ProcessTelegramPollingBatchInput) {
  const updates = await bot.getUpdates({ offset, timeoutSeconds });

  for (const update of updates) {
    await handleUpdate(update);
    await markProcessed(update.update_id);
  }

  return updates.length;
}

export async function runTelegramPolling(input: {
  token: string;
  timeoutSeconds?: number;
  idleDelayMs?: number;
  signal?: AbortSignal;
}) {
  const bot = createTelegramBotClient({ token: input.token });
  const timeoutSeconds = input.timeoutSeconds ?? 30;
  const idleDelayMs = input.idleDelayMs ?? 1000;

  while (!input.signal?.aborted) {
    const offset = await getNextTelegramOffset();
    await processTelegramPollingBatch({
      bot,
      offset,
      timeoutSeconds,
      handleUpdate: (update) => handleTelegramUpdate({ update, bot }),
      markProcessed: markTelegramUpdateProcessed,
    });
    await sleep(idleDelayMs);
  }
}
```

- [ ] **Step 4: Implement CLI script**

Create `scripts/telegram-poll.ts`:

```ts
import { runTelegramPolling } from "@/lib/telegram/polling";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

if (!token) {
  console.log("缺少 TELEGRAM_BOT_TOKEN，Telegram worker 未启动。");
  process.exit(0);
}

const timeoutSeconds = Number(process.env.TELEGRAM_POLL_TIMEOUT_SECONDS ?? 30);

runTelegramPolling({
  token,
  timeoutSeconds: Number.isFinite(timeoutSeconds) ? timeoutSeconds : 30,
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
```

- [ ] **Step 5: Run polling tests**

Run:

```bash
npm test -- tests/unit/telegram-polling.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/telegram/polling.ts scripts/telegram-poll.ts tests/unit/telegram-polling.test.ts
git commit -m "feat: add telegram long polling worker"
```

## Task 7: Package, Docker, and README Wiring

**Files:**
- Modify: `tests/unit/docker-files.test.ts`
- Modify: `package.json`
- Modify: `docker-compose.yml`
- Modify: `README.md`

- [ ] **Step 1: Write failing package and Docker assertions**

Update `tests/unit/docker-files.test.ts`:

```ts
  it("defines a Telegram worker service and script", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");
    const packageJson = readFileSync("package.json", "utf8");

    expect(packageJson).toContain('"telegram:poll": "tsx scripts/telegram-poll.ts"');
    expect(compose).toContain("telegram:");
    expect(compose).toContain("npm run telegram:poll");
    expect(compose).toContain("depends_on:");
    expect(compose).toContain("- web");
  });
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- tests/unit/docker-files.test.ts
```

Expected: FAIL because `telegram:poll` and the Docker service do not exist.

- [ ] **Step 3: Add package script**

In `package.json`, add:

```json
"telegram:poll": "tsx scripts/telegram-poll.ts"
```

Keep the scripts object valid JSON with commas in the correct positions.

- [ ] **Step 4: Add Docker service**

In `docker-compose.yml`, add:

```yaml
  telegram:
    build: .
    command: sh -c "npm run telegram:poll"
    env_file:
      - .env
    environment:
      DATABASE_URL: file:/app/data/commute.db
    volumes:
      - ./data:/app/data
    depends_on:
      - web
```

- [ ] **Step 5: Update README without overwriting unrelated edits**

In `README.md`, add a Telegram inbound section near the scheduler or notification configuration section:

```md
## Telegram 双向入口

配置 `TELEGRAM_BOT_TOKEN` 并在设置页保存 Telegram Chat ID 后，可以启动 Telegram 长轮询 worker：

```bash
npm run telegram:poll
```

用户可在 Telegram 中发送 `/new 明天九点到外事学校` 创建新行程，发送 `/trips` 通过内联按钮切换当前对话绑定的行程，发送 `/cancel` 取消当前行程监控。`/new` 只切换当前对话上下文，不会取消旧行程提醒。
```

If `README.md` has uncommitted user edits, keep them and insert only this section.

- [ ] **Step 6: Run Docker file tests**

Run:

```bash
npm test -- tests/unit/docker-files.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json docker-compose.yml README.md tests/unit/docker-files.test.ts
git commit -m "feat: wire telegram worker runtime"
```

## Task 8: Full Verification and Cleanup

**Files:**
- Inspect: all changed files

- [ ] **Step 1: Run focused Telegram tests**

Run:

```bash
npm test -- tests/unit/telegram-client.test.ts tests/unit/telegram-commands.test.ts tests/unit/telegram-polling.test.ts tests/integration/telegram-state.test.ts tests/integration/telegram-agent-entry.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run integration tests affected by Prisma and Agent changes**

Run:

```bash
npm test -- tests/integration/prisma-schema.test.ts tests/integration/agent-session.test.ts tests/integration/monitoring.test.ts tests/integration/scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run lint
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intended files changed. If user-owned unrelated changes remain, leave them unstaged.

- [ ] **Step 6: Final commit if verification caused any fixups**

If Step 1-4 required small fixes, commit them:

```bash
git add <fixed-files>
git commit -m "fix: verify telegram agent entry"
```

If no fixups were needed, skip this commit.

## Self-Review

- Spec coverage: The plan covers long polling, message and callback updates, inline trip switch buttons, chat binding, new planning, continuation, `/new`, `/trips`, `/status`, `/cancel`, offset persistence, Docker runtime, and scheduler separation.
- Placeholder scan: No task uses open-ended placeholders; each implementation step names concrete files, functions, commands, and expected results.
- Type consistency: Shared types originate in `src/lib/telegram/types.ts`; client, commands, handler, and polling import those same names. `TelegramChatState` and `TelegramBotState` names match Prisma tests and planned schema.
