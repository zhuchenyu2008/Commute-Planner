import { expect, test } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { ensureTestDatabase } from "../integration/test-db";

const email = "rus-011@example.com";
const password = "password";
const initialPrompt = "2026-07-03 09:00 arrive at Longhu Tianjie";
const changePrompt =
  "change destination to Foreign Affairs School, still arrive at 2026-07-03 09:00";
const expectedArriveAt = new Date("2026-07-03T01:00:00.000Z");
process.env.DATABASE_URL ??= "file:./e2e-test.db";
const agentRedirectTimeoutMs = Number(
  process.env.AGENT_REDIRECT_TIMEOUT_MS ?? 60_000
);
const schoolNamePattern = /foreign affairs school|外事学校/i;

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
      name: "RUS-011 User",
      passwordHash,
    },
    update: {
      passwordHash,
      name: "RUS-011 User",
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
    },
    update: {
      defaultCity: env.defaultCity,
      timezone: env.defaultTimezone,
      originName: "E2E Origin",
      originLngLat: "121.5230315924,29.8652491273",
    },
  });
});

test.afterAll(async () => {
  await prisma?.$disconnect();
});

test("RUS-011 replaces the active trip destination in the existing route", async ({
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

  expect(initialTrip.finalStopName).toBeTruthy();
  expect(initialTrip.finalStopName).not.toBe("Foreign Affairs School");
  expect(initialTrip.agentSessionId).toBeTruthy();
  expect(initialTrip.reminderJobs).toHaveLength(6);

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
      stops: { orderBy: { order: "asc" } },
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
  expect(activeTrip.finalStopName).toMatch(schoolNamePattern);
  expect(activeTrip.title).toMatch(schoolNamePattern);
  expect(activeTrip.stops.at(-1)?.name).toMatch(schoolNamePattern);
  expect(activeLeg.destinationName).toMatch(schoolNamePattern);
  expect(activeLeg.destinationLngLat).toBeTruthy();
  expect(totalMinutes).toBeGreaterThan(0);
  expect(activeLeg.latestDepartAt?.toISOString()).toBe(
    new Date(expectedArriveAt.getTime() - totalMinutes! * 60_000).toISOString()
  );
  expect(activeLeg.reminderJobs).toHaveLength(6);
  expect(activeTrip.reminderJobs).toHaveLength(6);
  expect(
    activeTrip.reminderJobs.some((job) => initialReminderIds.includes(job.id))
  ).toBe(false);
});
