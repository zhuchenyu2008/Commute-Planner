import { expect, test } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { ensureTestDatabase } from "../integration/test-db";

const email = "rus-012@example.com";
const password = "password";
const initialPrompt = "2026-07-03 09:00 到龙湖天街";
const addStopPrompt = "中途加一个咖啡店，停 5 分钟";
const removeStopPrompt = "取消中途停靠，直接去龙湖天街，还是 2026-07-03 09:00 到";
const expectedArriveAt = new Date("2026-07-03T01:00:00.000Z");
process.env.DATABASE_URL ??= "file:./e2e-test.db";
const agentRedirectTimeoutMs = Number(
  process.env.AGENT_REDIRECT_TIMEOUT_MS ?? 60_000
);
test.setTimeout(Number(process.env.RUS_012_TIMEOUT_MS ?? 600_000));
const longhuNamePattern = /longhu|龙湖|榫欐箹/i;
const stopoverNamePattern =
  /coffee|咖啡|星巴克|瑞幸|costa|便利店|7-eleven|全家|罗森/i;

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
      name: "RUS-012 User",
      passwordHash,
    },
    update: {
      passwordHash,
      name: "RUS-012 User",
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

test("RUS-012 adds a stopover and then removes it from the same active trip", async ({
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
  expect(initialTrip.finalStopName).toMatch(longhuNamePattern);
  expect(initialTrip.legs).toHaveLength(1);
  expect(initialTrip.reminderJobs).toHaveLength(6);
  expect(initialTrip.agentSessionId).toBeTruthy();

  await page.locator("a[href*='/agent/']").first().click();
  await page.waitForURL(/\/agent\/[^/]+\?view=conversation$/, {
    timeout: 10_000,
  });
  await page.locator("form input").last().fill(addStopPrompt);
  await page.locator("form button[type='submit']").last().click();
  await page.waitForURL(/\/trips\/[^/]+$/, {
    timeout: agentRedirectTimeoutMs,
  });

  const sessionAfterAdd = await prisma.agentSession.findUniqueOrThrow({
    where: { id: initialTrip.agentSessionId! },
  });
  expect(sessionAfterAdd.status).toBe("completed");
  expect(sessionAfterAdd.tripId).toBe(initialTrip.id);

  const tripAfterAdd = await prisma.trip.findUniqueOrThrow({
    where: { id: sessionAfterAdd.tripId! },
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
  const addedReminderIds = tripAfterAdd.reminderJobs.map((job) => job.id);
  const finalStopAfterAdd = tripAfterAdd.stops.at(-1);
  const stopoverAfterAdd = tripAfterAdd.stops.find((stop, index, stops) => {
    const isFinal = stop.id === stops.at(-1)?.id;
    return (
      !isFinal &&
      stop.kind !== "origin" &&
      (stop.plannedStayMin === 5 ||
        stop.name.match(stopoverNamePattern) ||
        stop.kind === "coffee" ||
        stop.kind === "stopover")
    );
  });

  expect(tripAfterAdd.targetArriveAt?.toISOString()).toBe(
    expectedArriveAt.toISOString()
  );
  expect(tripAfterAdd.finalStopName).toMatch(longhuNamePattern);
  expect(finalStopAfterAdd?.name).toMatch(longhuNamePattern);
  expect(stopoverAfterAdd).toBeTruthy();
  expect(stopoverAfterAdd?.plannedStayMin ?? 5).toBeGreaterThanOrEqual(0);
  expect(tripAfterAdd.legs.length).toBeGreaterThanOrEqual(2);
  expect(tripAfterAdd.legs.at(-1)?.destinationName).toMatch(longhuNamePattern);
  expect(
    tripAfterAdd.legs.some(
      (leg) =>
        leg.destinationName === stopoverAfterAdd?.name ||
        leg.destinationName.match(stopoverNamePattern)
    )
  ).toBe(true);
  for (const leg of tripAfterAdd.legs) {
    expect(leg.selectedCandidate?.totalMinutes).toBeGreaterThan(0);
    expect(leg.routeSegments.length).toBeGreaterThanOrEqual(1);
    expect(leg.reminderJobs).toHaveLength(6);
  }
  expect(tripAfterAdd.reminderJobs).toHaveLength(tripAfterAdd.legs.length * 6);
  expect(
    tripAfterAdd.reminderJobs.some((job) => initialReminderIds.includes(job.id))
  ).toBe(false);

  await page.locator("a[href*='/agent/']").first().click();
  await page.waitForURL(/\/agent\/[^/]+\?view=conversation$/, {
    timeout: 10_000,
  });
  await page.locator("form input").last().fill(removeStopPrompt);
  await page.locator("form button[type='submit']").last().click();
  await page.waitForURL(/\/trips\/[^/]+$/, {
    timeout: agentRedirectTimeoutMs,
  });

  const sessionAfterRemove = await prisma.agentSession.findUniqueOrThrow({
    where: { id: initialTrip.agentSessionId! },
  });
  expect(sessionAfterRemove.status).toBe("completed");
  expect(sessionAfterRemove.tripId).toBe(initialTrip.id);

  const tripAfterRemove = await prisma.trip.findUniqueOrThrow({
    where: { id: sessionAfterRemove.tripId! },
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
  const activeLeg = tripAfterRemove.legs[0];
  const totalMinutes = activeLeg?.selectedCandidate?.totalMinutes;

  expect(tripAfterRemove.targetArriveAt?.toISOString()).toBe(
    expectedArriveAt.toISOString()
  );
  expect(tripAfterRemove.finalStopName).toMatch(longhuNamePattern);
  expect(tripAfterRemove.stops.at(-1)?.name).toMatch(longhuNamePattern);
  expect(tripAfterRemove.legs).toHaveLength(1);
  expect(activeLeg?.destinationName).toMatch(longhuNamePattern);
  expect(totalMinutes).toBeGreaterThan(0);
  expect(activeLeg?.latestDepartAt?.toISOString()).toBe(
    new Date(expectedArriveAt.getTime() - totalMinutes! * 60_000).toISOString()
  );
  expect(activeLeg?.routeSegments.length).toBeGreaterThanOrEqual(1);
  expect(activeLeg?.reminderJobs).toHaveLength(6);
  expect(tripAfterRemove.reminderJobs).toHaveLength(6);
  expect(
    tripAfterRemove.reminderJobs.some((job) => addedReminderIds.includes(job.id))
  ).toBe(false);

  const scheduledRemindersForUser = await prisma.reminderJob.findMany({
    where: { status: "scheduled", trip: { userId } },
  });
  expect(scheduledRemindersForUser).toHaveLength(6);
  expect(new Set(scheduledRemindersForUser.map((job) => job.tripId))).toEqual(
    new Set([tripAfterRemove.id])
  );
});
