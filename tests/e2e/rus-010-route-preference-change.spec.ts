import { expect, test } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { ensureTestDatabase } from "../integration/test-db";

const email = "rus-010@example.com";
const password = "password";
const initialPrompt = "2026-07-03 09:00 arrive at Longhu Tianjie by transit";
const changePrompt = "switch to bicycling if weather allows";
const expectedArriveAt = new Date("2026-07-03T01:00:00.000Z");
process.env.DATABASE_URL ??= "file:./e2e-test.db";
const agentRedirectTimeoutMs = Number(
  process.env.AGENT_REDIRECT_TIMEOUT_MS ?? 60_000
);

let prisma: typeof PrismaInstance;
let userId: string;

test.beforeAll(async () => {
  const [{ hashPassword }, db, { readEnv }] = await Promise.all([
    import("../../src/lib/auth/password"),
    import("../../src/lib/db"),
    import("../../src/lib/env"),
  ]);
  prisma = db.prisma;
  const env = readEnv();
  const passwordHash = await hashPassword(password);

  await ensureTestDatabase();
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: "RUS-010 User",
      passwordHash,
    },
    update: {
      passwordHash,
      name: "RUS-010 User",
    },
  });
  userId = user.id;

  await prisma.session.deleteMany({ where: { userId } });
  await prisma.agentSession.deleteMany({ where: { userId } });
  await prisma.trip.deleteMany({ where: { userId } });
  await prisma.userSettings.upsert({
    where: { userId },
    create: {
      userId,
      defaultCity: env.defaultCity,
      timezone: env.defaultTimezone,
      originName: "E2E Origin",
      originLngLat: "121.5230315924,29.8652491273",
      routePreference: "balanced",
    },
    update: {
      defaultCity: env.defaultCity,
      timezone: env.defaultTimezone,
      originName: "E2E Origin",
      originLngLat: "121.5230315924,29.8652491273",
      routePreference: "balanced",
    },
  });
});

test.afterAll(async () => {
  await prisma?.$disconnect();
});

test("RUS-010 switches the active route to the requested travel preference", async ({
  page,
}) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL("/");

  await page.locator(".agent-prompt-source input").fill(initialPrompt);
  await page.locator(".agent-prompt-source button[type='submit']").click();
  await page.waitForURL(/\/trips\/[^/]+$/, {
    timeout: agentRedirectTimeoutMs,
  });

  const initialTrip = await prisma.trip.findFirstOrThrow({
    where: { userId, rawPrompt: initialPrompt },
    orderBy: { createdAt: "desc" },
    include: {
      legs: {
        orderBy: { order: "asc" },
        include: {
          selectedCandidate: true,
          reminderJobs: { orderBy: { scheduledFor: "asc" } },
        },
      },
      reminderJobs: { orderBy: { scheduledFor: "asc" } },
    },
  });
  const initialReminderIds = initialTrip.reminderJobs.map((job) => job.id);

  expect(initialTrip.targetArriveAt?.toISOString()).toBe(
    expectedArriveAt.toISOString()
  );
  expect(initialTrip.legs[0]?.selectedCandidate?.mode).toBe("transit");
  expect(initialTrip.agentSessionId).toBeTruthy();

  await page.locator("a[href*='/agent/']").first().click();
  await page.waitForURL(/\/agent\/[^/]+\?view=conversation$/, {
    timeout: 10_000,
  });
  await page.locator("form input").last().fill(changePrompt);
  await page.locator("form button[type='submit']").last().click();
  await page.waitForURL(/\/trips\/[^/]+$/, {
    timeout: agentRedirectTimeoutMs,
  });

  const continuedSession = await prisma.agentSession.findUniqueOrThrow({
    where: { id: initialTrip.agentSessionId! },
  });
  expect(continuedSession.status).toBe("completed");
  expect(continuedSession.tripId).toBe(initialTrip.id);

  const activeTrip = await prisma.trip.findUniqueOrThrow({
    where: { id: continuedSession.tripId! },
    include: {
      legs: {
        orderBy: { order: "asc" },
        include: {
          selectedCandidate: true,
          routeSegments: { orderBy: { order: "asc" } },
          reminderJobs: { orderBy: { scheduledFor: "asc" } },
        },
      },
      reminderJobs: { orderBy: { scheduledFor: "asc" } },
    },
  });
  const activeLeg = activeTrip.legs[0];
  const totalMinutes = activeLeg.selectedCandidate?.totalMinutes;

  expect(activeTrip.targetArriveAt?.toISOString()).toBe(
    expectedArriveAt.toISOString()
  );
  expect(activeLeg.selectedCandidate?.mode).toBe("bicycling");
  expect(activeLeg.selectedCandidate?.rationale).toMatch(/bicycling|骑行/i);
  expect(activeLeg.routeSegments[0]?.mode).toBe("bicycling");
  expect(totalMinutes).toBeGreaterThan(0);
  expect(activeLeg.latestDepartAt?.toISOString()).toBe(
    new Date(expectedArriveAt.getTime() - totalMinutes! * 60_000).toISOString()
  );
  expect(activeLeg.reminderJobs).toHaveLength(6);
  expect(activeTrip.reminderJobs).toHaveLength(6);
  expect(
    activeTrip.reminderJobs.some((job) => initialReminderIds.includes(job.id))
  ).toBe(false);

  const toolCalls = await prisma.agentToolCall.findMany({
    where: { agentSessionId: initialTrip.agentSessionId! },
    orderBy: { createdAt: "asc" },
  });
  expect(toolCalls.map((call) => call.name)).toContain("get_bicycling_route");
});
