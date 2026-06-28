# Agent Conversation Route Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-turn Agent conversation flow that can read confirmed memories, update the current route, close memory candidates, manage monitoring, and require user-selected default origins.

**Architecture:** Keep the existing Next.js App Router and Prisma/SQLite shape. Add small service helpers for settings, memories, Agent context, route replacement, and monitoring so API routes and Agent tools share the same tested behavior. Agent loops remain tool-driven and unrestricted by round count; wall-clock timeout stays the only run limit.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma/SQLite, Vitest, OpenAI-compatible chat completions, AMap Web Service.

---

## File Structure

- Modify `prisma/schema.prisma`: make `UserSettings.originName` and `originLngLat` nullable so configuration files do not provide a default origin.
- Create `prisma/migrations/20260628193000_optional_origin_settings/migration.sql`: migrate SQLite `UserSettings` to nullable origin fields.
- Modify `tests/integration/test-db.ts`: apply all migration SQL files in sorted order for integration tests.
- Modify `src/lib/env.ts`: remove `defaultOrigin` and `defaultOriginName`.
- Modify `prisma/seed.ts`: stop seeding origin fields from env.
- Modify `app/api/settings/route.ts`: return blank origin values when unset and validate origin as a selected pair.
- Modify `app/settings/page.tsx` and `app/settings/settings-form.tsx`: replace coordinate input with a POI selector and rename route preference UI.
- Create `app/api/places/search/route.ts`: authenticated POI search endpoint for settings.
- Modify `app/api/agent-sessions/route.ts`: block planning when origin is unset.
- Create `src/lib/memories/actions.ts`: confirm and ignore memory candidates.
- Create `src/lib/memories/context.ts`: build confirmed memory context for every Agent run.
- Create `app/api/memory-candidates/[candidateId]/confirm/route.ts` and `app/api/memory-candidates/[candidateId]/ignore/route.ts`.
- Create `src/components/memories/memory-candidate-actions.tsx`: client buttons for confirm and ignore.
- Modify `app/memories/page.tsx`: render candidate actions.
- Modify `src/lib/agent/types.ts`: add conversation and route-update tool names.
- Modify `src/lib/agent/planner.ts`: inject confirmed memories, add continuation runner, expose current-trip and update tools.
- Create `app/api/agent-sessions/[sessionId]/messages/route.ts`: append user messages and start a continuation run.
- Create `src/lib/trips/title.ts`: normalize route titles to `起点-终点`.
- Create `src/lib/trips/route-updates.ts`: transactional helpers for updating trip summaries, replacing route structure, selecting candidates, replacing reminders, and creating memory candidates.
- Create `src/lib/trips/monitoring.ts`: cancel monitoring and compute monitoring display data.
- Create `app/api/trips/[tripId]/cancel-monitoring/route.ts`: authenticated monitoring cancel endpoint.
- Create `src/components/trips/monitoring-actions.tsx`: client cancel button.
- Modify `app/trips/[tripId]/page.tsx`: show monitored duration, scheduled reminder count, and cancel action.
- Modify `src/components/agent/agent-event-list.tsx`: add conversation input and no-auto-redirect chat behavior.
- Modify tests under `tests/integration` and `tests/unit` as listed in the tasks.

## Task 1: Worktree Cleanup

**Files:**
- No source edits.

- [ ] **Step 1: Inspect registered worktrees**

Run:

```powershell
git worktree list
```

Expected: output includes `D:/code/Commute-Planner` and may include `D:/code/Commute-Planner/.worktrees/commute-planner-mvp`.

- [ ] **Step 2: Remove the stale registered worktree**

Run:

```powershell
git worktree remove --force .worktrees/commute-planner-mvp
```

Expected: command exits 0. If Git reports the directory is already missing, run `git worktree prune`.

- [ ] **Step 3: Remove the empty `.worktrees` directory**

Run:

```powershell
if ((Test-Path -LiteralPath '.worktrees') -and -not (Get-ChildItem -LiteralPath '.worktrees' -Force)) { Remove-Item -LiteralPath '.worktrees' -Force }
```

Expected: `.worktrees` is absent or empty. Do not delete any other directory.

- [ ] **Step 4: Verify root worktree remains intact**

Run:

```powershell
git worktree list
git status --short --branch
```

Expected: only `D:/code/Commute-Planner` remains registered. Existing unrelated root changes remain visible.

## Task 2: Optional Origin Settings

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260628193000_optional_origin_settings/migration.sql`
- Modify: `tests/integration/test-db.ts`
- Modify: `src/lib/env.ts`
- Modify: `prisma/seed.ts`
- Modify: `app/api/settings/route.ts`
- Test: `tests/integration/settings-api.test.ts`
- Test: `tests/integration/settings.test.ts`
- Test: `tests/unit/env.test.ts`

- [ ] **Step 1: Write failing settings API tests**

Add these tests to `tests/integration/settings-api.test.ts`:

```ts
it("returns blank origin fields when the user has not selected a default origin", async () => {
  const { GET } = await import("@app/api/settings/route");
  const user = await prisma.user.create({
    data: {
      email: `settings-no-origin-${Date.now()}@example.com`,
      name: "No Origin User",
      passwordHash: "hash",
    },
    include: { settings: true },
  });
  getCurrentUserMock.mockResolvedValue(user);

  const response = await GET();
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.settings.originName).toBe("");
  expect(body.settings.originLngLat).toBe("");
});

it("allows saving planner settings without an origin and requires origin name and coordinates as a pair", async () => {
  const { PUT } = await import("@app/api/settings/route");
  const user = await prisma.user.create({
    data: {
      email: `settings-origin-pair-${Date.now()}@example.com`,
      name: "Origin Pair User",
      passwordHash: "hash",
    },
    include: { settings: true },
  });
  getCurrentUserMock.mockResolvedValue(user);

  const withoutOrigin = await PUT(
    new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        defaultCity: "宁波",
        timezone: "Asia/Shanghai",
        routePreference: "balanced",
      }),
    })
  );
  const saved = await withoutOrigin.json();

  expect(withoutOrigin.status).toBe(200);
  expect(saved.settings.originName).toBeNull();
  expect(saved.settings.originLngLat).toBeNull();

  const missingCoordinates = await PUT(
    new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        defaultCity: "宁波",
        timezone: "Asia/Shanghai",
        originName: "外事学校",
        routePreference: "balanced",
      }),
    })
  );

  expect(missingCoordinates.status).toBe(400);
});
```

Update the existing default settings expectation in the same file:

```ts
expect(body.settings.originLngLat).toBe("");
```

- [ ] **Step 2: Write failing env and seed tests**

In `tests/unit/env.test.ts`, assert the env reader no longer exposes origin defaults:

```ts
it("does not expose default origin configuration", () => {
  const env = readEnv({
    DATABASE_URL: "file:./unit-test.db",
    DEFAULT_ORIGIN: "121,29",
    DEFAULT_ORIGIN_NAME: "Home",
  });

  expect("defaultOrigin" in env).toBe(false);
  expect("defaultOriginName" in env).toBe(false);
});
```

In `tests/integration/settings.test.ts`, add:

```ts
it("seeds users without origin fields from configuration", async () => {
  const user = await prisma.user.create({
    data: {
      email: `seedless-origin-${Date.now()}@example.com`,
      name: "Seedless Origin",
      passwordHash: "hash",
      settings: {
        create: {
          defaultCity: "宁波",
          timezone: "Asia/Shanghai",
          routePreference: "balanced",
        },
      },
    },
    include: { settings: true },
  });

  expect(user.settings?.originName).toBeNull();
  expect(user.settings?.originLngLat).toBeNull();
});
```

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```powershell
npm run test -- tests/integration/settings-api.test.ts tests/integration/settings.test.ts tests/unit/env.test.ts
```

Expected: FAIL because `originName` and `originLngLat` are required and env still exposes default origin values.

- [ ] **Step 4: Make origin fields nullable in Prisma**

Change `UserSettings` in `prisma/schema.prisma`:

```prisma
model UserSettings {
  id                  String   @id @default(cuid())
  userId              String   @unique
  defaultCity         String   @default("宁波")
  timezone            String   @default("Asia/Shanghai")
  originName          String?
  originLngLat        String?
  routePreference     String   @default("balanced")
  telegramChatId      String?
  emailRecipient      String?
  reminderCadenceJson String   @default("[30,20,15,10,5,0]")
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

Create `prisma/migrations/20260628193000_optional_origin_settings/migration.sql`:

```sql
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_UserSettings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "defaultCity" TEXT NOT NULL DEFAULT '宁波',
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  "originName" TEXT,
  "originLngLat" TEXT,
  "routePreference" TEXT NOT NULL DEFAULT 'balanced',
  "telegramChatId" TEXT,
  "emailRecipient" TEXT,
  "reminderCadenceJson" TEXT NOT NULL DEFAULT '[30,20,15,10,5,0]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_UserSettings" (
  "id",
  "userId",
  "defaultCity",
  "timezone",
  "originName",
  "originLngLat",
  "routePreference",
  "telegramChatId",
  "emailRecipient",
  "reminderCadenceJson",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "userId",
  "defaultCity",
  "timezone",
  "originName",
  "originLngLat",
  "routePreference",
  "telegramChatId",
  "emailRecipient",
  "reminderCadenceJson",
  "createdAt",
  "updatedAt"
FROM "UserSettings";

DROP TABLE "UserSettings";
ALTER TABLE "new_UserSettings" RENAME TO "UserSettings";
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

PRAGMA foreign_keys=ON;
```

- [ ] **Step 5: Apply all migrations in integration tests**

Replace the single-file migration logic in `tests/integration/test-db.ts` with sorted migration application:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";

let ensured = false;

function splitSqlStatements(sql: string) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function readMigrationFiles() {
  return readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join("prisma/migrations", entry.name, "migration.sql"))
    .sort();
}

export async function ensureTestDatabase() {
  if (ensured) return;

  const databaseUrl = process.env.DATABASE_URL;
  if (
    !databaseUrl ||
    !databaseUrl.startsWith("file:./") ||
    !/(test|verify|e2e)/i.test(databaseUrl)
  ) {
    throw new Error(
      "Integration tests require DATABASE_URL to be an explicit test SQLite file."
    );
  }

  const existing = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'User'"
  );

  if (existing.length === 0) {
    for (const migrationPath of readMigrationFiles()) {
      const migration = readFileSync(migrationPath, "utf8");
      for (const statement of splitSqlStatements(migration)) {
        await prisma.$executeRawUnsafe(statement);
      }
    }
  }

  ensured = true;
}
```

- [ ] **Step 6: Remove origin defaults from env and seed**

Change `src/lib/env.ts` so `AppEnv` has no origin fields:

```ts
export type AppEnv = {
  databaseUrl: string;
  defaultCity: string;
  defaultTimezone: string;
  hasAmapKey: boolean;
  hasOpenAiKey: boolean;
  hasTelegramConfig: boolean;
  hasEmailConfig: boolean;
};
```

Remove these properties from `readEnv`:

```ts
defaultOrigin: env.DEFAULT_ORIGIN ?? "121.5230315924,29.8652491273",
defaultOriginName: env.DEFAULT_ORIGIN_NAME ?? "家",
```

Change `prisma/seed.ts` settings creation and update data:

```ts
settings: {
  create: {
    defaultCity: appEnv.defaultCity,
    timezone: appEnv.defaultTimezone,
    routePreference: "balanced",
  },
}
```

and in the `upsert.update.settings.upsert` block:

```ts
create: {
  defaultCity: appEnv.defaultCity,
  timezone: appEnv.defaultTimezone,
  routePreference: "balanced",
},
update: {
  defaultCity: appEnv.defaultCity,
  timezone: appEnv.defaultTimezone,
}
```

- [ ] **Step 7: Update settings API validation**

In `app/api/settings/route.ts`, change defaults:

```ts
function getSettingsDefaults() {
  const env = readEnv();
  return {
    defaultCity: env.defaultCity,
    timezone: env.defaultTimezone,
    originName: null,
    originLngLat: null,
    routePreference: "balanced",
    telegramChatId: null,
    emailRecipient: null,
  };
}
```

Use nullable origin fields in `validateSettings`:

```ts
function validateSettings(data: {
  defaultCity: string;
  timezone: string;
  originName: string | null;
  originLngLat: string | null;
  routePreference: string;
  telegramChatId: string | null;
  emailRecipient: string | null;
}) {
  const errors: string[] = [];

  if (!data.defaultCity) errors.push("默认城市不能为空");
  if (!TIMEZONES.has(data.timezone)) errors.push("不支持该时区");
  if (Boolean(data.originName) !== Boolean(data.originLngLat)) {
    errors.push("默认出发点必须从候选地点中选择");
  }
  if (data.originLngLat && !isValidLngLat(data.originLngLat)) {
    errors.push("默认出发点坐标无效");
  }
  if (!ROUTE_PREFERENCES.has(data.routePreference)) {
    errors.push("不支持该通勤方式倾向");
  }
  if (data.emailRecipient && !EMAIL_PATTERN.test(data.emailRecipient)) {
    errors.push("邮件接收人格式无效");
  }

  return errors;
}
```

Build `data` with nullable origin values:

```ts
const originName = asOptionalString(body.originName) ?? null;
const originLngLat = asOptionalString(body.originLngLat) ?? null;
const data = {
  defaultCity: readRequiredString(body, "defaultCity", defaults.defaultCity),
  timezone: readRequiredString(body, "timezone", defaults.timezone),
  originName,
  originLngLat,
  routePreference: readRequiredString(body, "routePreference", defaults.routePreference),
  telegramChatId: asOptionalString(body.telegramChatId) ?? null,
  emailRecipient: asOptionalString(body.emailRecipient) ?? null,
};
```

When returning settings from `GET`, normalize nulls to empty strings for the UI:

```ts
const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
const values = settings ?? getSettingsDefaults();

return NextResponse.json({
  settings: {
    ...values,
    originName: values.originName ?? "",
    originLngLat: values.originLngLat ?? "",
  },
});
```

- [ ] **Step 8: Run focused tests and commit**

Run:

```powershell
npm run test -- tests/integration/settings-api.test.ts tests/integration/settings.test.ts tests/unit/env.test.ts
```

Expected: PASS.

Commit:

```powershell
git add prisma/schema.prisma prisma/migrations/20260628193000_optional_origin_settings/migration.sql tests/integration/test-db.ts src/lib/env.ts prisma/seed.ts app/api/settings/route.ts tests/integration/settings-api.test.ts tests/integration/settings.test.ts tests/unit/env.test.ts
git commit -m "feat: require user-selected origin settings"
```

## Task 3: Settings Place Selector

**Files:**
- Create: `app/api/places/search/route.ts`
- Modify: `app/settings/page.tsx`
- Modify: `app/settings/settings-form.tsx`
- Test: `tests/integration/settings-api.test.ts`
- Test: `tests/unit/ui-components.test.tsx`

- [ ] **Step 1: Write failing place search API test**

Add to `tests/integration/settings-api.test.ts`:

```ts
it("searches origin candidates for authenticated users", async () => {
  const { GET } = await import("@app/api/places/search/route");
  const user = await prisma.user.create({
    data: {
      email: `place-search-${Date.now()}@example.com`,
      name: "Place Search User",
      passwordHash: "hash",
    },
    include: { settings: true },
  });
  getCurrentUserMock.mockResolvedValue(user);

  const response = await GET(
    new Request("http://localhost/api/places/search?keywords=外事学校&city=宁波")
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.places[0]).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      name: expect.any(String),
      lngLat: expect.stringMatching(/^-?\d/),
    })
  );
});
```

- [ ] **Step 2: Write failing settings form rendering test**

Add to `tests/unit/ui-components.test.tsx`:

```tsx
import { SettingsForm } from "@app/settings/settings-form";

it("renders a default origin selector without a visible coordinate input", () => {
  const html = renderToStaticMarkup(
    <SettingsForm
      values={{
        defaultCity: "宁波",
        timezone: "Asia/Shanghai",
        originName: "",
        originLngLat: "",
        routePreference: "balanced",
        telegramChatId: "",
        emailRecipient: "",
      }}
    />
  );

  expect(html).toContain("默认出发点");
  expect(html).toContain("通勤方式倾向");
  expect(html).toContain("公交地铁优先");
  expect(html).not.toContain("出发点坐标");
  expect(html).toContain('name="originLngLat"');
  expect(html).toContain('type="hidden"');
});
```

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```powershell
npm run test -- tests/integration/settings-api.test.ts tests/unit/ui-components.test.tsx
```

Expected: FAIL because the search endpoint does not exist and the form still shows coordinate fields.

- [ ] **Step 4: Implement the place search endpoint**

Create `app/api/places/search/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createAmapClient } from "@/lib/amap";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const url = new URL(request.url);
  const keywords = url.searchParams.get("keywords")?.trim() ?? "";
  const city = url.searchParams.get("city")?.trim() || undefined;

  if (!keywords) {
    return NextResponse.json({ error: "请输入地点关键词" }, { status: 400 });
  }

  const places = await createAmapClient().searchPoi({ keywords, city });

  return NextResponse.json({ places });
}
```

- [ ] **Step 5: Update settings page values**

In `app/settings/page.tsx`, remove `readEnv()` and use blanks for unset origin fields:

```ts
const values = {
  defaultCity: settings?.defaultCity ?? "宁波",
  timezone: settings?.timezone ?? "Asia/Shanghai",
  originName: settings?.originName ?? "",
  originLngLat: settings?.originLngLat ?? "",
  routePreference: settings?.routePreference ?? "balanced",
  telegramChatId: settings?.telegramChatId ?? "",
  emailRecipient: settings?.emailRecipient ?? "",
};
```

- [ ] **Step 6: Replace coordinate input with a selector**

In `app/settings/settings-form.tsx`, replace the mapped `fields` form with explicit controls. The origin section must use hidden coordinate input and search candidates:

```tsx
const routePreferenceOptions = [
  ["balanced", "均衡"],
  ["fastest", "省时间优先"],
  ["habit", "贴近日常习惯"],
  ["transit", "公交地铁优先"],
  ["bike", "骑行优先"],
] as const;

type PlaceCandidate = {
  id: string;
  name: string;
  address: string;
  lngLat: string;
};
```

Add state:

```tsx
const [originName, setOriginName] = useState(values.originName);
const [originLngLat, setOriginLngLat] = useState(values.originLngLat);
const [originQuery, setOriginQuery] = useState(values.originName);
const [places, setPlaces] = useState<PlaceCandidate[]>([]);
const [placeStatus, setPlaceStatus] = useState("");
```

Add search function:

```tsx
async function searchPlaces() {
  const keywords = originQuery.trim();
  if (!keywords) {
    setPlaceStatus("请输入地点关键词");
    return;
  }

  setPlaceStatus("正在搜索");
  const response = await fetch(
    `/api/places/search?keywords=${encodeURIComponent(keywords)}&city=${encodeURIComponent(values.defaultCity)}`
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    setPlaceStatus(payload.error ?? "地点搜索失败");
    return;
  }

  setPlaces(Array.isArray(payload.places) ? payload.places : []);
  setPlaceStatus("");
}
```

Render the origin section:

```tsx
<section className="grid gap-3 py-4 md:grid-cols-[160px_1fr] md:items-start">
  <span className="text-sm font-medium text-on-surface-variant">默认出发点</span>
  <div className="space-y-3">
    <input name="originName" type="hidden" value={originName} />
    <input name="originLngLat" type="hidden" value={originLngLat} />
    <div className="flex gap-2">
      <input
        className="min-w-0 flex-1 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-base text-on-surface outline-none ring-primary/20 transition focus:ring-4"
        onChange={(event) => setOriginQuery(event.target.value)}
        placeholder="搜索地点，例如外事学校"
        type="search"
        value={originQuery}
      />
      <button
        className="rounded-2xl bg-[#2563eb] px-4 py-3 text-sm font-semibold text-white"
        onClick={searchPlaces}
        type="button"
      >
        搜索
      </button>
    </div>
    {originName ? (
      <p className="text-sm font-semibold text-[#191c1e]">已选择：{originName}</p>
    ) : (
      <p className="text-sm font-medium text-on-surface-variant">请从候选地点中选择默认出发点。</p>
    )}
    {placeStatus ? <p className="text-sm font-medium text-on-surface-variant">{placeStatus}</p> : null}
    <div className="space-y-2">
      {places.map((place) => (
        <button
          className="w-full rounded-2xl bg-white/70 px-4 py-3 text-left text-sm text-[#191c1e]"
          key={place.id}
          onClick={() => {
            setOriginName(place.name);
            setOriginLngLat(place.lngLat);
            setOriginQuery(place.name);
          }}
          type="button"
        >
          <span className="block font-bold">{place.name}</span>
          <span className="block text-xs text-[#434655]">{place.address || place.lngLat}</span>
        </button>
      ))}
    </div>
  </div>
</section>
```

Render route preference as a select:

```tsx
<select
  className="w-full rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-base text-on-surface outline-none ring-primary/20 transition focus:ring-4"
  defaultValue={values.routePreference}
  name="routePreference"
>
  {routePreferenceOptions.map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ))}
</select>
```

- [ ] **Step 7: Run focused tests and commit**

Run:

```powershell
npm run test -- tests/integration/settings-api.test.ts tests/unit/ui-components.test.tsx
```

Expected: PASS.

Commit:

```powershell
git add app/api/places/search/route.ts app/settings/page.tsx app/settings/settings-form.tsx tests/integration/settings-api.test.ts tests/unit/ui-components.test.tsx
git commit -m "feat: select default origin from place search"
```

## Task 4: Memory Candidate Actions and Agent Memory Context

**Files:**
- Create: `src/lib/memories/actions.ts`
- Create: `src/lib/memories/context.ts`
- Create: `app/api/memory-candidates/[candidateId]/confirm/route.ts`
- Create: `app/api/memory-candidates/[candidateId]/ignore/route.ts`
- Create: `src/components/memories/memory-candidate-actions.tsx`
- Modify: `app/memories/page.tsx`
- Modify: `src/lib/agent/planner.ts`
- Test: `tests/integration/memory-candidates.test.ts`
- Test: `tests/integration/agent-session.test.ts`
- Test: `tests/unit/memory-display.test.ts`

- [ ] **Step 1: Write failing memory candidate tests**

Create `tests/integration/memory-candidates.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { ensureTestDatabase } from "./test-db";

type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;
const getCurrentUserMock = vi.hoisted(() => vi.fn<() => Promise<CurrentUser | null>>());

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, getCurrentUser: getCurrentUserMock };
});

describe("memory candidate actions", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  beforeEach(() => {
    getCurrentUserMock.mockReset();
  });

  it("confirms a candidate into a reusable memory", async () => {
    const { POST } = await import("@app/api/memory-candidates/[candidateId]/confirm/route");
    const user = await prisma.user.create({
      data: { email: `confirm-memory-${Date.now()}@example.com`, name: "Memory User", passwordHash: "hash" },
    });
    const candidate = await prisma.memoryCandidate.create({
      data: {
        userId: user.id,
        kind: "origin",
        label: "常从外事学校出发",
        valueJson: JSON.stringify({ originName: "外事学校", originLngLat: "121.1,29.1" }),
      },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ candidateId: candidate.id }),
    });

    expect(response.status).toBe(200);
    await expect(prisma.memory.findFirstOrThrow({ where: { userId: user.id, label: "常从外事学校出发" } })).resolves.toMatchObject({
      kind: "origin",
      label: "常从外事学校出发",
    });
    await expect(prisma.memoryCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).resolves.toMatchObject({
      status: "confirmed",
    });
  });

  it("ignores a candidate without creating memory", async () => {
    const { POST } = await import("@app/api/memory-candidates/[candidateId]/ignore/route");
    const user = await prisma.user.create({
      data: { email: `ignore-memory-${Date.now()}@example.com`, name: "Ignore User", passwordHash: "hash" },
    });
    const candidate = await prisma.memoryCandidate.create({
      data: {
        userId: user.id,
        kind: "preference",
        label: "偏好骑行",
        valueJson: JSON.stringify({ mode: "bike" }),
      },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ candidateId: candidate.id }),
    });

    expect(response.status).toBe(200);
    await expect(prisma.memory.count({ where: { userId: user.id, label: "偏好骑行" } })).resolves.toBe(0);
    await expect(prisma.memoryCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).resolves.toMatchObject({
      status: "ignored",
    });
  });
});
```

- [ ] **Step 2: Write failing Agent memory context test**

Add to `tests/integration/agent-session.test.ts`:

```ts
it("injects confirmed memories into every planning run before the AI calls tools", async () => {
  const user = await prisma.user.create({
    data: {
      email: `agent-memory-context-${Date.now()}@example.com`,
      name: "Memory Context User",
      passwordHash: "hash",
      settings: {
        create: {
          defaultCity: "宁波",
          timezone: "Asia/Shanghai",
          originName: "外事学校",
          originLngLat: "121.1,29.1",
          routePreference: "balanced",
        },
      },
      memories: {
        create: {
          kind: "origin",
          label: "用户确认常从外事学校出发",
          valueJson: JSON.stringify({ originName: "外事学校", originLngLat: "121.1,29.1" }),
        },
      },
    },
  });
  const session = await startPlanningSession({
    userId: user.id,
    prompt: "明天 10:00 到东钱湖地铁站",
  });
  const seenMessages: string[] = [];
  const chatClient: AgentChatClient = {
    async complete({ messages }) {
      seenMessages.push(...messages.map((message) => message.content));
      return {
        message: {
          role: "assistant",
          content: "根据确认记忆创建行程。",
          toolCalls: [
            {
              id: "create-from-memory",
              name: "create_trip",
              arguments: {
                title: "外事学校-东钱湖地铁站",
                timezone: "Asia/Shanghai",
                finalStopName: "东钱湖地铁站",
                stops: [{ order: 1, name: "东钱湖地铁站", lngLat: "121.2,29.2", kind: "destination" }],
                legs: [{
                  order: 1,
                  originName: "外事学校",
                  originLngLat: "121.1,29.1",
                  destinationName: "东钱湖地铁站",
                  destinationLngLat: "121.2,29.2",
                  routeMinutes: 25,
                  bufferComponents: [{ category: "transfer", label: "进站缓冲", minutes: 5, reason: "预留进站时间" }],
                }],
              },
            },
          ],
        },
      };
    },
  };

  await runPlanningSession(session.id, { chatClient });

  expect(seenMessages.join("\n")).toContain("用户已确认的长期记忆");
  expect(seenMessages.join("\n")).toContain("用户确认常从外事学校出发");
});
```

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```powershell
npm run test -- tests/integration/memory-candidates.test.ts tests/integration/agent-session.test.ts
```

Expected: FAIL because candidate endpoints and memory context injection do not exist.

- [ ] **Step 4: Implement memory actions**

Create `src/lib/memories/actions.ts`:

```ts
import { prisma } from "@/lib/db";

export async function confirmMemoryCandidate(input: {
  candidateId: string;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.memoryCandidate.findFirst({
      where: { id: input.candidateId, userId: input.userId },
    });

    if (!candidate) {
      throw new Error("未找到记忆候选");
    }

    if (candidate.status !== "pending") {
      return { status: candidate.status };
    }

    await tx.memory.create({
      data: {
        userId: candidate.userId,
        kind: candidate.kind,
        label: candidate.label,
        valueJson: candidate.valueJson,
      },
    });

    await tx.memoryCandidate.update({
      where: { id: candidate.id },
      data: { status: "confirmed" },
    });

    return { status: "confirmed" };
  });
}

export async function ignoreMemoryCandidate(input: {
  candidateId: string;
  userId: string;
}) {
  const result = await prisma.memoryCandidate.updateMany({
    where: {
      id: input.candidateId,
      userId: input.userId,
      status: "pending",
    },
    data: { status: "ignored" },
  });

  if (result.count !== 1) {
    const existing = await prisma.memoryCandidate.findFirst({
      where: { id: input.candidateId, userId: input.userId },
    });

    if (!existing) {
      throw new Error("未找到记忆候选");
    }
  }

  return { status: "ignored" };
}
```

- [ ] **Step 5: Implement memory candidate API routes**

Create `app/api/memory-candidates/[candidateId]/confirm/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { confirmMemoryCandidate } from "@/lib/memories/actions";

type RouteContext = {
  params: Promise<{ candidateId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { candidateId } = await context.params;

  try {
    const result = await confirmMemoryCandidate({ candidateId, userId: user.id });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "确认记忆失败" },
      { status: 404 }
    );
  }
}
```

Create `app/api/memory-candidates/[candidateId]/ignore/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { ignoreMemoryCandidate } from "@/lib/memories/actions";

type RouteContext = {
  params: Promise<{ candidateId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { candidateId } = await context.params;

  try {
    const result = await ignoreMemoryCandidate({ candidateId, userId: user.id });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "忽略记忆失败" },
      { status: 404 }
    );
  }
}
```

- [ ] **Step 6: Build confirmed memory context**

Create `src/lib/memories/context.ts`:

```ts
import { prisma } from "@/lib/db";

export async function buildConfirmedMemoryContext(userId: string) {
  const memories = await prisma.memory.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  if (memories.length === 0) {
    return "用户已确认的长期记忆：暂无。";
  }

  const lines = memories.map((memory, index) => {
    return `${index + 1}. [${memory.kind}] ${memory.label}: ${memory.valueJson}`;
  });

  return [
    "用户已确认的长期记忆如下。",
    "这些记忆已经由用户确认，后续规划和续聊时应作为长期偏好、常用地点或习惯证据使用。",
    ...lines,
  ].join("\n");
}
```

Update `src/lib/agent/planner.ts`:

```ts
import { buildConfirmedMemoryContext } from "@/lib/memories/context";
```

Change `createInitialMessages` to async and inject memory context:

```ts
async function createInitialMessages(
  session: { prompt: string; userId: string },
  attempt: number
) {
  const memoryContext = await buildConfirmedMemoryContext(session.userId);
  const messages: AgentChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: memoryContext },
    {
      role: "user",
      content: `第 ${attempt} 次规划请求：${session.prompt}`,
    },
  ];

  return messages;
}
```

Update call site:

```ts
const messages = await createInitialMessages(session, attempt);
```

- [ ] **Step 7: Render candidate action buttons**

Create `src/components/memories/memory-candidate-actions.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MemoryCandidateActions({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState("");

  async function submit(action: "confirm" | "ignore") {
    setStatus(action === "confirm" ? "正在确认" : "正在忽略");
    const response = await fetch(`/api/memory-candidates/${candidateId}/${action}`, {
      method: "POST",
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(payload.error ?? "操作失败");
      return;
    }

    setStatus(action === "confirm" ? "已确认" : "已忽略");
    router.refresh();
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button
        className="rounded-full bg-[#2563eb] px-4 py-2 text-sm font-bold text-white"
        onClick={() => submit("confirm")}
        type="button"
      >
        确认
      </button>
      <button
        className="rounded-full bg-[#f2f4f6] px-4 py-2 text-sm font-bold text-[#434655]"
        onClick={() => submit("ignore")}
        type="button"
      >
        忽略
      </button>
      {status ? <span className="text-xs font-semibold text-[#434655]">{status}</span> : null}
    </div>
  );
}
```

In `app/memories/page.tsx`, import and render:

```tsx
import { MemoryCandidateActions } from "@/components/memories/memory-candidate-actions";
```

Inside each candidate card:

```tsx
<MemoryCandidateActions candidateId={candidate.id} />
```

- [ ] **Step 8: Run focused tests and commit**

Run:

```powershell
npm run test -- tests/integration/memory-candidates.test.ts tests/integration/agent-session.test.ts tests/unit/memory-display.test.ts
```

Expected: PASS.

Commit:

```powershell
git add src/lib/memories/actions.ts src/lib/memories/context.ts app/api/memory-candidates src/components/memories/memory-candidate-actions.tsx app/memories/page.tsx src/lib/agent/planner.ts tests/integration/memory-candidates.test.ts tests/integration/agent-session.test.ts tests/unit/memory-display.test.ts
git commit -m "feat: confirm memories into agent context"
```

## Task 5: Route Title Normalization

**Files:**
- Create: `src/lib/trips/title.ts`
- Modify: `src/lib/trips/create-trip.ts`
- Test: `tests/unit/trip-title.test.ts`
- Test: `tests/integration/create-trip.test.ts`

- [ ] **Step 1: Write failing title unit tests**

Create `tests/unit/trip-title.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeRouteTitle } from "@/lib/trips/title";

describe("normalizeRouteTitle", () => {
  it("formats a single-leg route as origin-destination without time text", () => {
    expect(
      normalizeRouteTitle({
        title: "明天10:00 外事学校到东钱湖地铁站",
        originName: "外事学校",
        destinationName: "东钱湖地铁站",
      })
    ).toBe("外事学校-东钱湖地铁站");
  });

  it("falls back to the provided title when endpoints are missing", () => {
    expect(normalizeRouteTitle({ title: "临时行程" })).toBe("临时行程");
  });
});
```

Add to `tests/integration/create-trip.test.ts`:

```ts
it("normalizes created trip titles to origin-destination", async () => {
  const user = await prisma.user.create({
    data: { email: `title-normalize-${Date.now()}@example.com`, name: "Title User", passwordHash: "hash" },
  });

  const trip = await createPlannedTrip({
    userId: user.id,
    rawPrompt: "明天10:00 外事学校到东钱湖地铁站",
    timezone: "Asia/Shanghai",
    title: "明天10:00 外事学校到东钱湖地铁站",
    stops: [{ order: 1, name: "东钱湖地铁站", lngLat: "121.2,29.2", kind: "destination" }],
    legs: [{
      order: 1,
      originName: "外事学校",
      originLngLat: "121.1,29.1",
      destinationName: "东钱湖地铁站",
      destinationLngLat: "121.2,29.2",
      routeMinutes: 25,
      bufferComponents: [{ category: "transfer", label: "进站缓冲", minutes: 5, reason: "预留进站时间" }],
    }],
  });

  await expect(prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).resolves.toMatchObject({
    title: "外事学校-东钱湖地铁站",
  });
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
npm run test -- tests/unit/trip-title.test.ts tests/integration/create-trip.test.ts
```

Expected: FAIL because the title helper does not exist and creation keeps the AI title unchanged.

- [ ] **Step 3: Implement title normalization**

Create `src/lib/trips/title.ts`:

```ts
type NormalizeRouteTitleInput = {
  title?: string | null;
  originName?: string | null;
  destinationName?: string | null;
};

function cleanEndpoint(value?: string | null) {
  return value?.replace(/\s+/g, "").trim() ?? "";
}

export function normalizeRouteTitle({
  title,
  originName,
  destinationName,
}: NormalizeRouteTitleInput) {
  const origin = cleanEndpoint(originName);
  const destination = cleanEndpoint(destinationName);

  if (origin && destination) {
    return `${origin}-${destination}`;
  }

  return title?.trim() || "未命名行程";
}
```

In `src/lib/trips/create-trip.ts`, import the helper:

```ts
import { normalizeRouteTitle } from "@/lib/trips/title";
```

Before creating the trip, compute endpoints:

```ts
const firstLeg = input.legs?.[0];
const firstStop = input.stops[0];
const lastStop = input.stops[input.stops.length - 1];
const normalizedTitle = normalizeRouteTitle({
  title: input.title,
  originName: firstLeg?.originName ?? input.stops[0]?.name,
  destinationName: firstLeg?.destinationName ?? input.finalStopName ?? lastStop?.name,
});
```

Use it in `tx.trip.create`:

```ts
title: normalizedTitle,
```

- [ ] **Step 4: Run focused tests and commit**

Run:

```powershell
npm run test -- tests/unit/trip-title.test.ts tests/integration/create-trip.test.ts
```

Expected: PASS.

Commit:

```powershell
git add src/lib/trips/title.ts src/lib/trips/create-trip.ts tests/unit/trip-title.test.ts tests/integration/create-trip.test.ts
git commit -m "feat: normalize route titles"
```

## Task 6: Agent Continuation and Route Update Tools

**Files:**
- Modify: `src/lib/agent/types.ts`
- Modify: `src/lib/agent/planner.ts`
- Create: `src/lib/trips/route-updates.ts`
- Create: `app/api/agent-sessions/[sessionId]/messages/route.ts`
- Modify: `app/api/agent-sessions/[sessionId]/route.ts`
- Modify: `app/api/agent-sessions/route.ts`
- Test: `tests/integration/agent-session.test.ts`
- Test: `tests/integration/route-update-tools.test.ts`

- [ ] **Step 1: Write failing origin guard test**

Add to `tests/integration/agent-session.test.ts`:

```ts
it("rejects new planning sessions until the user selects a default origin", async () => {
  vi.resetModules();
  const getCurrentUserMock = vi.hoisted(() => vi.fn());
  vi.doMock("@/lib/auth/session", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/auth/session")>();
    return { ...actual, getCurrentUser: getCurrentUserMock };
  });
  const { POST } = await import("@app/api/agent-sessions/route");
  const user = await prisma.user.create({
    data: {
      email: `agent-no-origin-${Date.now()}@example.com`,
      name: "No Origin Agent User",
      passwordHash: "hash",
      settings: { create: { defaultCity: "宁波", timezone: "Asia/Shanghai", routePreference: "balanced" } },
    },
    include: { settings: true },
  });
  getCurrentUserMock.mockResolvedValue(user);

  const response = await POST(
    new Request("http://localhost/api/agent-sessions", {
      method: "POST",
      body: JSON.stringify({ prompt: "明天10点到东钱湖地铁站" }),
    })
  );
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.error).toContain("请先在设置中选择默认出发点");
});
```

- [ ] **Step 2: Write failing route update tool test**

Create `tests/integration/route-update-tools.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createPlannedTrip } from "@/lib/trips/create-trip";
import { replaceTripRoute, updateTripSummary } from "@/lib/trips/route-updates";
import { ensureTestDatabase } from "./test-db";

describe("route update tools", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  it("updates trip summary and replaces route structure transactionally", async () => {
    const user = await prisma.user.create({
      data: { email: `route-update-${Date.now()}@example.com`, name: "Route Update User", passwordHash: "hash" },
    });
    const trip = await createPlannedTrip({
      userId: user.id,
      rawPrompt: "到东钱湖",
      timezone: "Asia/Shanghai",
      title: "家-东钱湖",
      stops: [{ order: 1, name: "东钱湖", lngLat: "121.2,29.2", kind: "destination" }],
      legs: [{
        order: 1,
        originName: "家",
        originLngLat: "121.1,29.1",
        destinationName: "东钱湖",
        destinationLngLat: "121.2,29.2",
        routeMinutes: 40,
        bufferComponents: [{ category: "transfer", label: "换乘", minutes: 5, reason: "预留换乘" }],
      }],
    });

    await updateTripSummary({
      tripId: trip.id,
      userId: user.id,
      title: "外事学校-东钱湖地铁站",
      finalStopName: "东钱湖地铁站",
    });
    await replaceTripRoute({
      tripId: trip.id,
      userId: user.id,
      timezone: "Asia/Shanghai",
      stops: [{ order: 1, name: "东钱湖地铁站", lngLat: "121.3,29.3", kind: "destination" }],
      legs: [{
        order: 1,
        originName: "外事学校",
        originLngLat: "121.4,29.4",
        destinationName: "东钱湖地铁站",
        destinationLngLat: "121.3,29.3",
        routeMinutes: 28,
        mode: "bicycling",
        routeTitle: "骑行到东钱湖地铁站",
        bufferComponents: [{ category: "parking", label: "停车", minutes: 3, reason: "锁车" }],
      }],
    });

    const updated = await prisma.trip.findUniqueOrThrow({
      where: { id: trip.id },
      include: {
        stops: true,
        legs: { include: { selectedCandidate: true, bufferComponents: true } },
        reminderJobs: true,
      },
    });

    expect(updated).toMatchObject({ title: "外事学校-东钱湖地铁站", finalStopName: "东钱湖地铁站" });
    expect(updated.stops).toHaveLength(1);
    expect(updated.legs).toHaveLength(1);
    expect(updated.legs[0]).toMatchObject({ originName: "外事学校", destinationName: "东钱湖地铁站" });
    expect(updated.legs[0].selectedCandidate).toMatchObject({ mode: "bicycling", routeMinutes: 28 });
    expect(updated.legs[0].bufferComponents).toHaveLength(1);
    expect(updated.reminderJobs.some((job) => job.status === "scheduled")).toBe(true);
  });
});
```

- [ ] **Step 3: Write failing continuation test**

Add to `tests/integration/agent-session.test.ts`:

```ts
it("continues an existing trip conversation and lets the AI update the route", async () => {
  const user = await prisma.user.create({
    data: {
      email: `agent-continue-${Date.now()}@example.com`,
      name: "Continue User",
      passwordHash: "hash",
      settings: {
        create: {
          defaultCity: "宁波",
          timezone: "Asia/Shanghai",
          originName: "外事学校",
          originLngLat: "121.4,29.4",
          routePreference: "balanced",
        },
      },
    },
  });
  const session = await startPlanningSession({ userId: user.id, prompt: "明天10点到东钱湖" });
  const trip = await createPlannedTrip({
    userId: user.id,
    agentSessionId: session.id,
    rawPrompt: "明天10点到东钱湖",
    timezone: "Asia/Shanghai",
    title: "外事学校-东钱湖",
    stops: [{ order: 1, name: "东钱湖", lngLat: "121.2,29.2", kind: "destination" }],
    legs: [{
      order: 1,
      originName: "外事学校",
      originLngLat: "121.4,29.4",
      destinationName: "东钱湖",
      destinationLngLat: "121.2,29.2",
      routeMinutes: 40,
      bufferComponents: [{ category: "transfer", label: "换乘", minutes: 5, reason: "预留换乘" }],
    }],
  });
  await prisma.agentSession.update({ where: { id: session.id }, data: { tripId: trip.id, status: "completed" } });

  const result = await continueAgentSession(
    {
      sessionId: session.id,
      userId: user.id,
      message: "改成东钱湖地铁站，并记住我常从外事学校出发",
    },
    {
      chatClient: {
        async complete() {
          return {
            message: {
              role: "assistant",
              content: "我会更新线路并创建记忆候选。",
              toolCalls: [
                {
                  id: "update-summary",
                  name: "update_trip_summary",
                  arguments: { title: "外事学校-东钱湖地铁站", finalStopName: "东钱湖地铁站" },
                },
                {
                  id: "memory-candidate",
                  name: "create_memory_candidate",
                  arguments: {
                    kind: "origin",
                    label: "常从外事学校出发",
                    valueJson: { originName: "外事学校", originLngLat: "121.4,29.4" },
                  },
                },
              ],
            },
          };
        },
      },
    }
  );

  expect(result.status).toBe("completed");
  await expect(prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).resolves.toMatchObject({
    title: "外事学校-东钱湖地铁站",
    finalStopName: "东钱湖地铁站",
  });
  await expect(prisma.memoryCandidate.findFirstOrThrow({ where: { userId: user.id, label: "常从外事学校出发" } })).resolves.toMatchObject({
    status: "pending",
  });
});
```

- [ ] **Step 4: Run focused tests and verify failure**

Run:

```powershell
npm run test -- tests/integration/route-update-tools.test.ts tests/integration/agent-session.test.ts
```

Expected: FAIL because route update helpers, continuation runner, and tools do not exist.

- [ ] **Step 5: Expand Agent tool types**

In `src/lib/agent/types.ts`, replace `AgentToolName` with:

```ts
export type AgentToolName =
  | "read_settings"
  | "read_memories"
  | "read_current_trip"
  | "search_poi"
  | "get_poi_detail"
  | "get_weather_reference"
  | "get_transit_route"
  | "get_walking_route"
  | "get_bicycling_route"
  | "create_trip"
  | "update_trip_summary"
  | "replace_trip_stops"
  | "replace_trip_legs"
  | "select_route_candidate"
  | "replace_reminder_schedule"
  | "cancel_trip_monitoring"
  | "create_memory_candidate";
```

Add continuation input:

```ts
export type ContinueAgentSessionInput = {
  userId: string;
  sessionId: string;
  message: string;
};
```

- [ ] **Step 6: Implement route update helpers**

Create `src/lib/trips/route-updates.ts` with these exported functions:

```ts
import { prisma } from "@/lib/db";
import { buildReminderSchedule } from "@/lib/trips/reminders";
import { normalizeBufferComponents } from "@/lib/trips/buffers";
import { normalizeRouteTitle } from "@/lib/trips/title";
import type { BufferComponentInput, PlannedTripLegInput, PlannedTripStopInput } from "@/lib/trips/types";

type UpdateTripSummaryInput = {
  tripId: string;
  userId: string;
  title?: string;
  finalStopName?: string;
  targetArriveAt?: Date;
  status?: string;
};

type ReplaceTripRouteInput = {
  tripId: string;
  userId: string;
  timezone: string;
  stops: PlannedTripStopInput[];
  legs: PlannedTripLegInput[];
};

function requireStopsAndLegs(input: ReplaceTripRouteInput) {
  if (input.stops.length === 0) throw new Error("更新线路至少需要一个目的地");
  if (input.legs.length === 0) throw new Error("更新线路至少需要一段路线");
}

function latestDepartAt(leg: PlannedTripLegInput, routeMinutes: number, bufferMinutes: number) {
  const arriveAt = leg.targetArriveAt ?? new Date();
  return leg.latestDepartAt ?? new Date(arriveAt.getTime() - (routeMinutes + bufferMinutes) * 60_000);
}

export async function updateTripSummary(input: UpdateTripSummaryInput) {
  const trip = await prisma.trip.findFirstOrThrow({
    where: { id: input.tripId, userId: input.userId },
  });
  return prisma.trip.update({
    where: { id: trip.id },
    data: {
      title: input.title ?? trip.title,
      finalStopName: input.finalStopName ?? trip.finalStopName,
      targetArriveAt: input.targetArriveAt ?? trip.targetArriveAt,
      status: input.status ?? trip.status,
    },
  });
}

export async function replaceTripRoute(input: ReplaceTripRouteInput) {
  requireStopsAndLegs(input);

  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirstOrThrow({
      where: { id: input.tripId, userId: input.userId },
    });

    await tx.reminderJob.updateMany({
      where: { tripId: trip.id, status: "scheduled" },
      data: { status: "cancelled" },
    });
    await tx.bufferComponent.deleteMany({ where: { leg: { tripId: trip.id } } });
    await tx.routeSegment.deleteMany({ where: { leg: { tripId: trip.id } } });
    await tx.routeCandidate.deleteMany({ where: { leg: { tripId: trip.id } } });
    await tx.tripLeg.deleteMany({ where: { tripId: trip.id } });
    await tx.tripStop.deleteMany({ where: { tripId: trip.id } });

    const stops = [];
    for (const [index, stop] of input.stops.entries()) {
      stops.push(await tx.tripStop.create({
        data: {
          tripId: trip.id,
          order: stop.order ?? index + 1,
          name: stop.name,
          address: stop.address,
          lngLat: stop.lngLat,
          targetArriveAt: stop.targetArriveAt,
          plannedStayMin: stop.plannedStayMin,
          kind: stop.kind ?? "destination",
          notes: stop.notes,
        },
      }));
    }

    for (const [index, legInput] of input.legs.entries()) {
      const toStop = stops[index] ?? stops[stops.length - 1];
      const buffers = normalizeBufferComponents(legInput.bufferComponents as BufferComponentInput[]);
      const routeMinutes = Math.max(0, Math.round(legInput.routeMinutes));
      const bufferMinutes = Math.max(0, Math.round(legInput.bufferMinutes ?? buffers.reduce((sum, item) => sum + item.minutes, 0)));
      const departAt = latestDepartAt(legInput, routeMinutes, bufferMinutes);
      const originName = legInput.originName ?? "";
      const destinationName = legInput.destinationName ?? toStop.name;
      const leg = await tx.tripLeg.create({
        data: {
          tripId: trip.id,
          order: legInput.order ?? index + 1,
          toStopId: toStop.id,
          originName,
          originLngLat: legInput.originLngLat ?? "",
          destinationName,
          destinationLngLat: legInput.destinationLngLat ?? toStop.lngLat,
          targetArriveAt: legInput.targetArriveAt ?? toStop.targetArriveAt,
          latestDepartAt: departAt,
          status: "monitoring",
        },
      });
      const candidate = await tx.routeCandidate.create({
        data: {
          legId: leg.id,
          key: `leg-${leg.order}-selected-${Date.now()}`,
          title: legInput.routeTitle ?? normalizeRouteTitle({ originName, destinationName }),
          mode: legInput.mode ?? "transit",
          routeMinutes,
          bufferMinutes,
          totalMinutes: routeMinutes + bufferMinutes,
          selected: true,
          rationale: legInput.routeRationale ?? "由智能体根据对话更新。",
          sourceJson: legInput.source === undefined ? undefined : JSON.stringify(legInput.source),
        },
      });
      await tx.tripLeg.update({ where: { id: leg.id }, data: { selectedCandidateId: candidate.id } });
      await tx.routeSegment.create({
        data: {
          legId: leg.id,
          candidateId: candidate.id,
          order: 0,
          mode: legInput.mode ?? "transit",
          title: legInput.segmentTitle ?? candidate.title,
          detail: legInput.segmentDetail,
          minutes: routeMinutes,
          source: legInput.segmentSource ?? "agent",
        },
      });
      await tx.bufferComponent.createMany({
        data: buffers.map((buffer) => ({
          legId: leg.id,
          order: buffer.order,
          category: buffer.category,
          label: buffer.label,
          minutes: buffer.minutes,
          reason: buffer.reason,
          source: buffer.source,
        })),
      });
      await tx.reminderJob.createMany({ data: buildReminderSchedule({ tripId: trip.id, legId: leg.id, latestDepartAt: departAt }) });
    }

    return tx.trip.update({
      where: { id: trip.id },
      data: {
        title: normalizeRouteTitle({
          title: trip.title,
          originName: input.legs[0]?.originName,
          destinationName: input.legs[input.legs.length - 1]?.destinationName ?? input.stops[input.stops.length - 1]?.name,
        }),
        finalStopName: input.stops[input.stops.length - 1]?.name,
        status: "monitoring",
      },
    });
  });
}
```

Also export:

```ts
export async function createMemoryCandidateForTrip(input: {
  userId: string;
  kind: string;
  label: string;
  valueJson: unknown;
}) {
  return prisma.memoryCandidate.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      label: input.label,
      valueJson: typeof input.valueJson === "string" ? input.valueJson : JSON.stringify(input.valueJson),
    },
  });
}
```

- [ ] **Step 7: Add current-trip and update tools to planner**

In `src/lib/agent/planner.ts`, import helpers:

```ts
import {
  createMemoryCandidateForTrip,
  replaceTripRoute,
  updateTripSummary,
} from "@/lib/trips/route-updates";
```

Add tool definitions for `read_current_trip`, `update_trip_summary`, `replace_trip_stops`, `replace_trip_legs`, and `create_memory_candidate`.

Add to `getToolName` allowed set the new names from `AgentToolName`.

In `executeToolCall`, handle:

```ts
if (name === "read_current_trip") {
  return recordToolCall({
    agentSessionId: context.sessionId,
    name,
    request: { tripId: context.tripId },
    signal: context.signal,
    run: async () => {
      if (!context.tripId) throw new Error("当前会话没有关联行程");
      return prisma.trip.findFirstOrThrow({
        where: { id: context.tripId, userId: context.userId },
        include: {
          stops: { orderBy: { order: "asc" } },
          legs: {
            orderBy: { order: "asc" },
            include: {
              selectedCandidate: true,
              routeCandidates: true,
              routeSegments: { orderBy: { order: "asc" } },
              bufferComponents: { orderBy: { order: "asc" } },
              reminderJobs: true,
            },
          },
        },
      });
    },
  });
}
```

Handle summary updates:

```ts
if (name === "update_trip_summary") {
  if (!context.tripId) throw new Error("当前会话没有关联行程");
  const request = {
    tripId: context.tripId,
    userId: context.userId,
    title: readOptionalString(args, "title"),
    finalStopName: readOptionalString(args, "finalStopName"),
    targetArriveAt: readOptionalDate(args, "targetArriveAt"),
    status: readOptionalString(args, "status"),
  };
  return recordToolCall({
    agentSessionId: context.sessionId,
    name,
    request,
    signal: context.signal,
    run: () => updateTripSummary(request),
  });
}
```

Handle route replacement when either `replace_trip_stops` or `replace_trip_legs` is called with both arrays:

```ts
if (name === "replace_trip_stops" || name === "replace_trip_legs") {
  if (!context.tripId) throw new Error("当前会话没有关联行程");
  const request = {
    tripId: context.tripId,
    userId: context.userId,
    timezone: readOptionalString(args, "timezone") ?? settings.timezone,
    stops: readArray(args, "stops").map(normalizeStop),
    legs: readArray(args, "legs").map(normalizeLeg),
  };
  return recordToolCall({
    agentSessionId: context.sessionId,
    name,
    request,
    signal: context.signal,
    run: () => replaceTripRoute(request),
  });
}
```

Handle memory candidates:

```ts
if (name === "create_memory_candidate") {
  const request = {
    userId: context.userId,
    kind: readString(args, "kind"),
    label: readString(args, "label"),
    valueJson: args.valueJson ?? {},
  };
  return recordToolCall({
    agentSessionId: context.sessionId,
    name,
    request,
    signal: context.signal,
    run: () => createMemoryCandidateForTrip(request),
  });
}
```

- [ ] **Step 8: Add continuation runner**

In `src/lib/agent/planner.ts`, add to `ToolExecutionContext`:

```ts
tripId?: string | null;
```

Create `continueAgentSession`:

```ts
export async function continueAgentSession(
  input: ContinueAgentSessionInput,
  options: RunPlanningSessionOptions = {}
): Promise<PlanningSessionResult> {
  const message = normalizePrompt(input.message);
  const session = await prisma.agentSession.findFirstOrThrow({
    where: { id: input.sessionId, userId: input.userId },
  });

  await prisma.agentSession.update({
    where: { id: session.id },
    data: {
      status: "running",
      messages: { create: { role: "user", content: message } },
    },
  });

  try {
    const result = await runWithTimeoutAndRetry({
      timeoutMs: SESSION_TIMEOUT_MS,
      maxAttempts: SESSION_MAX_ATTEMPTS,
      run: async ({ attempt, signal }) =>
        runConversationAttempt(session.id, attempt, signal, options),
    });

    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: "completed", retryCount: result.attempts - 1 },
    });

    return { sessionId: session.id, status: "completed", tripId: session.tripId };
  } catch (error) {
    await prisma.agentSession.update({
      where: { id: session.id },
      data: {
        status: error instanceof AgentRunTimeoutError ? "timed_out" : "failed",
        messages: { create: { role: "assistant", content: formatPlanningFailureMessage(error) } },
      },
    });
    return { sessionId: session.id, status: error instanceof AgentRunTimeoutError ? "timed_out" : "failed", tripId: session.tripId };
  }
}
```

Create `runConversationAttempt` that reads history and accepts a final assistant response with no tool calls:

```ts
async function runConversationAttempt(
  sessionId: string,
  attempt = 1,
  signal?: AbortSignal,
  options: RunPlanningSessionOptions = {}
) {
  const session = await prisma.agentSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  const settings = await loadPlanningSettings(session.userId);
  const memoryContext = await buildConfirmedMemoryContext(session.userId);
  const chatClient = options.chatClient ?? createOpenAiChatClient();
  const context: ToolExecutionContext = {
    amap: createAmapClient(),
    sessionId,
    userId: session.userId,
    tripId: session.tripId,
    prompt: session.prompt,
    signal,
  };
  const messages: AgentChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: memoryContext },
    { role: "system", content: `这是第 ${attempt} 次续聊运行。请基于当前行程和历史消息回答，并在需要时调用线路更新工具。` },
    ...session.messages.map((message) => ({
      role: message.role === "assistant" ? "assistant" as const : "user" as const,
      content: message.content,
    })),
  ];

  while (true) {
    const completion = await chatClient.complete({ messages, tools: TOOL_DEFINITIONS, signal });
    const assistantMessage = completion.message;
    messages.push(assistantMessage);
    await createAssistantMessage({
      sessionId,
      signal,
      content: assistantMessage.content || "AI 请求调用工具继续处理。",
      metadata: { toolCalls: assistantMessage.toolCalls?.map((toolCall) => ({ id: toolCall.id, name: toolCall.name })) },
    });

    const toolCalls = assistantMessage.toolCalls ?? [];
    if (toolCalls.length === 0) {
      return { tripId: session.tripId ?? "", summary: assistantMessage.content };
    }

    for (const toolCall of toolCalls) {
      const result = await executeToolCall(toolCall, context, settings);
      messages.push({ role: "tool", toolCallId: toolCall.id, content: stringifyToolResult(result) });
    }
  }
}
```

- [ ] **Step 9: Add continuation API route**

Create `app/api/agent-sessions/[sessionId]/messages/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { continueAgentSession } from "@/lib/agent/planner";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!message) {
    return NextResponse.json({ error: "请输入要告诉智能体的内容" }, { status: 400 });
  }

  const { sessionId } = await context.params;

  void continueAgentSession({ userId: user.id, sessionId, message });

  return NextResponse.json({ status: "running" });
}
```

- [ ] **Step 10: Block planning without selected origin**

In `app/api/agent-sessions/route.ts`, after prompt validation:

```ts
const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
if (!settings?.originName || !settings.originLngLat) {
  return NextResponse.json(
    { error: "请先在设置中选择默认出发点", actionHref: "/settings" },
    { status: 400 }
  );
}
```

- [ ] **Step 11: Run focused tests and commit**

Run:

```powershell
npm run test -- tests/integration/route-update-tools.test.ts tests/integration/agent-session.test.ts
```

Expected: PASS.

Commit:

```powershell
git add src/lib/agent/types.ts src/lib/agent/planner.ts src/lib/trips/route-updates.ts app/api/agent-sessions tests/integration/agent-session.test.ts tests/integration/route-update-tools.test.ts
git commit -m "feat: continue agent conversations with route tools"
```

## Task 7: Monitoring Status and Cancellation

**Files:**
- Create: `src/lib/trips/monitoring.ts`
- Create: `app/api/trips/[tripId]/cancel-monitoring/route.ts`
- Create: `src/components/trips/monitoring-actions.tsx`
- Modify: `app/trips/[tripId]/page.tsx`
- Test: `tests/integration/monitoring.test.ts`
- Test: `tests/unit/ui-components.test.tsx`

- [ ] **Step 1: Write failing monitoring tests**

Create `tests/integration/monitoring.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createPlannedTrip } from "@/lib/trips/create-trip";
import { cancelTripMonitoring, getMonitoringSummary } from "@/lib/trips/monitoring";
import { ensureTestDatabase } from "./test-db";

describe("trip monitoring", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  it("cancels trip, legs, and scheduled reminders", async () => {
    const user = await prisma.user.create({
      data: { email: `monitoring-${Date.now()}@example.com`, name: "Monitoring User", passwordHash: "hash" },
    });
    const trip = await createPlannedTrip({
      userId: user.id,
      rawPrompt: "到东钱湖",
      timezone: "Asia/Shanghai",
      title: "外事学校-东钱湖",
      stops: [{ order: 1, name: "东钱湖", lngLat: "121.2,29.2", kind: "destination" }],
      legs: [{
        order: 1,
        originName: "外事学校",
        originLngLat: "121.1,29.1",
        destinationName: "东钱湖",
        destinationLngLat: "121.2,29.2",
        routeMinutes: 30,
        bufferComponents: [{ category: "transfer", label: "换乘", minutes: 5, reason: "预留换乘" }],
      }],
    });

    await cancelTripMonitoring({ tripId: trip.id, userId: user.id });

    const updated = await prisma.trip.findUniqueOrThrow({
      where: { id: trip.id },
      include: { legs: true, reminderJobs: true },
    });
    expect(updated.status).toBe("cancelled");
    expect(updated.legs.every((leg) => leg.status === "cancelled")).toBe(true);
    expect(updated.reminderJobs.every((job) => job.status === "cancelled")).toBe(true);
  });

  it("summarizes monitored duration and scheduled reminder count", async () => {
    const summary = getMonitoringSummary({
      createdAt: new Date("2026-06-28T00:00:00.000Z"),
      now: new Date("2026-06-28T01:35:00.000Z"),
      scheduledReminderCount: 2,
    });

    expect(summary.monitoredFor).toBe("1小时35分钟");
    expect(summary.scheduledReminderCount).toBe(2);
  });
});
```

Add UI rendering check to `tests/unit/ui-components.test.tsx` after creating a small exported formatter in Step 3:

```tsx
import { formatMonitoredDuration } from "@/lib/trips/monitoring";

it("formats monitored duration for detail display", () => {
  expect(
    formatMonitoredDuration({
      createdAt: new Date("2026-06-28T00:00:00.000Z"),
      now: new Date("2026-06-28T00:45:00.000Z"),
    })
  ).toBe("45分钟");
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
npm run test -- tests/integration/monitoring.test.ts tests/unit/ui-components.test.tsx
```

Expected: FAIL because monitoring helpers do not exist.

- [ ] **Step 3: Implement monitoring helpers**

Create `src/lib/trips/monitoring.ts`:

```ts
import { prisma } from "@/lib/db";

export function formatMonitoredDuration(input: { createdAt: Date; now?: Date }) {
  const now = input.now ?? new Date();
  const minutes = Math.max(0, Math.floor((now.getTime() - input.createdAt.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours > 0 && rest > 0) return `${hours}小时${rest}分钟`;
  if (hours > 0) return `${hours}小时`;
  return `${rest}分钟`;
}

export function getMonitoringSummary(input: {
  createdAt: Date;
  now?: Date;
  scheduledReminderCount: number;
}) {
  return {
    monitoredFor: formatMonitoredDuration({ createdAt: input.createdAt, now: input.now }),
    scheduledReminderCount: input.scheduledReminderCount,
  };
}

export async function cancelTripMonitoring(input: { tripId: string; userId: string }) {
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirstOrThrow({
      where: { id: input.tripId, userId: input.userId },
      include: { legs: true },
    });

    await tx.trip.update({ where: { id: trip.id }, data: { status: "cancelled" } });
    await tx.tripLeg.updateMany({ where: { tripId: trip.id }, data: { status: "cancelled" } });
    await tx.reminderJob.updateMany({
      where: { tripId: trip.id, status: "scheduled" },
      data: { status: "cancelled" },
    });

    return { status: "cancelled" };
  });
}
```

- [ ] **Step 4: Add cancel-monitoring API**

Create `app/api/trips/[tripId]/cancel-monitoring/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { cancelTripMonitoring } from "@/lib/trips/monitoring";

type RouteContext = {
  params: Promise<{ tripId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { tripId } = await context.params;
  const result = await cancelTripMonitoring({ tripId, userId: user.id });

  return NextResponse.json(result);
}
```

- [ ] **Step 5: Add detail page cancel action**

Create `src/components/trips/monitoring-actions.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MonitoringActions({ tripId, disabled }: { tripId: string; disabled: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState("");

  async function cancelMonitoring() {
    setStatus("正在取消");
    const response = await fetch(`/api/trips/${tripId}/cancel-monitoring`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(payload.error ?? "取消监控失败");
      return;
    }

    setStatus("已取消监控");
    router.refresh();
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        className="rounded-full bg-[#93000a] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={cancelMonitoring}
        type="button"
      >
        取消监控
      </button>
      {status ? <span className="text-xs font-semibold text-[#38485d]">{status}</span> : null}
    </div>
  );
}
```

In `app/trips/[tripId]/page.tsx`, import:

```ts
import { MonitoringActions } from "@/components/trips/monitoring-actions";
import { getMonitoringSummary } from "@/lib/trips/monitoring";
```

Compute:

```ts
const scheduledReminderCount = reminders.filter((reminder) => reminder.status === "scheduled").length;
const monitoringSummary = getMonitoringSummary({
  createdAt: trip.createdAt,
  scheduledReminderCount,
});
```

Render in monitoring card:

```tsx
<dl className="mt-4 grid gap-3 text-sm text-[#38485d]">
  <div>
    <dt className="font-bold">已监控时间</dt>
    <dd>{monitoringSummary.monitoredFor}</dd>
  </div>
  <div>
    <dt className="font-bold">待提醒</dt>
    <dd>{monitoringSummary.scheduledReminderCount} 个</dd>
  </div>
</dl>
<MonitoringActions tripId={trip.id} disabled={trip.status === "cancelled"} />
```

- [ ] **Step 6: Run focused tests and commit**

Run:

```powershell
npm run test -- tests/integration/monitoring.test.ts tests/unit/ui-components.test.tsx
```

Expected: PASS.

Commit:

```powershell
git add src/lib/trips/monitoring.ts app/api/trips src/components/trips/monitoring-actions.tsx app/trips/[tripId]/page.tsx tests/integration/monitoring.test.ts tests/unit/ui-components.test.tsx
git commit -m "feat: manage trip monitoring state"
```

## Task 8: Conversation UI

**Files:**
- Modify: `src/components/agent/agent-event-list.tsx`
- Modify: `app/agent/[sessionId]/page.tsx`
- Modify: `src/components/home/commute-input.tsx`
- Test: `tests/unit/ui-components.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add to `tests/unit/ui-components.test.tsx`:

```tsx
import { getAgentSendMessageResult } from "@/components/agent/agent-event-list";

it("keeps completed conversation sessions interactive", () => {
  const state = getAgentSessionViewState({
    autoRedirect: false,
    session: { status: "completed", tripId: "trip-1" },
  });

  expect(state.isTerminal).toBe(true);
  expect(state.redirectTo).toBeNull();
});

it("formats agent continuation API results", () => {
  expect(getAgentSendMessageResult(202, { status: "running" })).toEqual({
    error: "",
    accepted: true,
  });
  expect(getAgentSendMessageResult(400, { error: "请输入要告诉智能体的内容" })).toEqual({
    error: "请输入要告诉智能体的内容",
    accepted: false,
  });
});
```

- [ ] **Step 2: Run focused UI tests and verify failure**

Run:

```powershell
npm run test -- tests/unit/ui-components.test.tsx
```

Expected: FAIL because `getAgentSendMessageResult` does not exist.

- [ ] **Step 3: Add send-message result helper**

In `src/components/agent/agent-event-list.tsx`, export:

```ts
export function getAgentSendMessageResult(
  status: number,
  payload: { error?: unknown; status?: unknown }
) {
  if (status >= 200 && status < 300 && payload.status === "running") {
    return { accepted: true, error: "" };
  }

  return {
    accepted: false,
    error: typeof payload.error === "string" ? payload.error : "无法发送消息",
  };
}
```

- [ ] **Step 4: Add conversation form to AgentEventList**

In `AgentEventList`, add state:

```tsx
const [message, setMessage] = useState("");
const [isSending, setIsSending] = useState(false);
```

Add handler:

```tsx
async function sendMessage(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const trimmed = message.trim();
  if (!trimmed) {
    setError("请输入要告诉智能体的内容");
    return;
  }

  setIsSending(true);
  const response = await fetch(`/api/agent-sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: trimmed }),
  });
  const payload = await response.json().catch(() => ({}));
  const result = getAgentSendMessageResult(response.status, payload);
  setIsSending(false);

  if (!result.accepted) {
    setError(result.error);
    return;
  }

  setMessage("");
  setError("");
  const refreshed = await fetch(`/api/agent-sessions/${sessionId}`);
  const refreshedPayload = await refreshed.json().catch(() => ({}));
  if (refreshed.ok) setSession(refreshedPayload.session);
}
```

Import `FormEvent`:

```ts
import { FormEvent, useEffect, useState } from "react";
```

Render the form only in conversation mode:

```tsx
{!autoRedirect ? (
  <form className="mt-4 flex gap-2" onSubmit={sendMessage}>
    <input
      className="min-w-0 flex-1 rounded-2xl bg-white/80 px-4 py-3 text-sm text-[#191c1e] outline-none ring-[#2563eb]/20 focus:ring-4"
      onChange={(event) => setMessage(event.target.value)}
      placeholder="继续告诉智能体要怎么调整这条线路"
      value={message}
    />
    <button
      className="rounded-2xl bg-[#2563eb] px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
      disabled={isSending || viewState.status === "running"}
      type="submit"
    >
      发送
    </button>
  </form>
) : null}
```

- [ ] **Step 5: Improve home submission error for missing origin**

In `src/components/home/commute-input.tsx`, extend result helper:

```ts
export function getAgentStartResult(
  status: number,
  payload: { error?: unknown; sessionId?: unknown; actionHref?: unknown }
) {
  if (status === 401) {
    return { error: "", route: "/login" };
  }

  if (status >= 200 && status < 300 && typeof payload.sessionId === "string") {
    return { error: "", route: `/agent/${payload.sessionId}` };
  }

  if (typeof payload.actionHref === "string") {
    return {
      error: typeof payload.error === "string" ? payload.error : "请先完成设置",
      route: payload.actionHref,
    };
  }

  return {
    error: typeof payload.error === "string" ? payload.error : "无法开始规划。",
    route: null,
  };
}
```

- [ ] **Step 6: Run focused tests and commit**

Run:

```powershell
npm run test -- tests/unit/ui-components.test.tsx
```

Expected: PASS.

Commit:

```powershell
git add src/components/agent/agent-event-list.tsx app/agent/[sessionId]/page.tsx src/components/home/commute-input.tsx tests/unit/ui-components.test.tsx
git commit -m "feat: continue agent conversations from details"
```

## Task 9: Final Verification and Documentation

**Files:**
- Modify: `README.md`
- Modify: `.env` example text if the repository has one.
- Modify only files required by verification failures.

- [ ] **Step 1: Remove default origin references from docs**

In `README.md`, remove references to `DEFAULT_ORIGIN` and `DEFAULT_ORIGIN_NAME`. Add this text to settings documentation:

```md
默认出发点不通过环境变量配置。用户登录后需要在设置页通过地点搜索选择默认出发点，系统会保存地点名称和坐标。
```

- [ ] **Step 2: Run unit and integration tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: Run type check**

Run:

```powershell
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 5: Run E2E if build succeeds**

Run:

```powershell
npm run test:e2e -- tests/e2e/commute-flow.spec.ts --reporter=line --workers=1
```

Expected: PASS. If browser dependencies are unavailable, record the exact error and keep unit, integration, lint, and build results in the final report.

- [ ] **Step 6: Commit final documentation and fixes**

Run:

```powershell
git add README.md
git commit -m "docs: update origin setting guidance"
```

If verification required source fixes, include those files in the same commit with README.
