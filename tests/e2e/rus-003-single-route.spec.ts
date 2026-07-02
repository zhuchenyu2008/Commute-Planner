import { expect, test } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { ensureTestDatabase } from "../integration/test-db";

const email = "rus-003@example.com";
const password = "password";
const prompt = "2026-07-03 09:15 arrive at Longhu Tianjie";
const expectedArriveAt = new Date("2026-07-03T01:15:00.000Z");
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
      name: "RUS-003 User",
      passwordHash,
    },
    update: {
      passwordHash,
      name: "RUS-003 User",
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

test("RUS-003 creates a complete single-destination arrival-time route", async ({
  page,
}) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL("/");

  await page.locator(".agent-prompt-source input").fill(prompt);
  await page.locator(".agent-prompt-source button[type='submit']").click();

  await page.waitForURL(/\/trips\/[^/]+$/, {
    timeout: agentRedirectTimeoutMs,
  });
  await expect(page.locator("a[href*='/agent/']").first()).toBeVisible();

  const trip = await prisma.trip.findFirst({
    where: { userId, rawPrompt: prompt },
    orderBy: { createdAt: "desc" },
    include: {
      stops: { orderBy: { order: "asc" } },
      legs: {
        orderBy: { order: "asc" },
        include: {
          selectedCandidate: true,
          routeSegments: { orderBy: { order: "asc" } },
          bufferComponents: { orderBy: { order: "asc" } },
          reminderJobs: { orderBy: { scheduledFor: "asc" } },
        },
      },
      reminderJobs: { orderBy: { scheduledFor: "asc" } },
    },
  });

  expect(trip).toBeTruthy();
  expect(trip?.status).toBe("monitoring");
  expect(trip?.targetArriveAt?.toISOString()).toBe(expectedArriveAt.toISOString());
  expect(trip?.stops.length).toBeGreaterThanOrEqual(1);
  expect(trip?.legs).toHaveLength(1);

  const leg = trip?.legs[0];
  expect(leg?.originName).toBe("E2E Origin");
  expect(leg?.destinationName).toBeTruthy();
  expect(leg?.targetArriveAt?.toISOString()).toBe(expectedArriveAt.toISOString());
  expect(leg?.selectedCandidate).toBeTruthy();
  expect(leg?.routeSegments.length).toBeGreaterThanOrEqual(1);
  expect(leg?.bufferComponents.length).toBeGreaterThanOrEqual(1);
  expect(leg?.reminderJobs).toHaveLength(6);
  expect(trip?.reminderJobs).toHaveLength(6);

  const totalMinutes = leg?.selectedCandidate?.totalMinutes;
  expect(totalMinutes).toBeGreaterThan(0);
  const latestDepartAt = leg?.latestDepartAt;
  expect(latestDepartAt).toBeTruthy();
  expect(latestDepartAt?.toISOString()).toBe(
    new Date(expectedArriveAt.getTime() - totalMinutes! * 60_000).toISOString()
  );
});
