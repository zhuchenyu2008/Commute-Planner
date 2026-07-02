import { expect, test } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { ensureTestDatabase } from "../integration/test-db";

const email = "rus-005@example.com";
const password = "password";
const prompt =
  "2026-07-03 08:10 first to Foreign Affairs School, stay 10 minutes, then arrive Longhu Tianjie as office by 09:00";
const expectedOfficeArriveAt = new Date("2026-07-03T01:00:00.000Z");
process.env.DATABASE_URL ??= "file:./e2e-test.db";
const agentRedirectTimeoutMs = Number(
  process.env.AGENT_REDIRECT_TIMEOUT_MS ?? 60_000
);
const schoolNamePattern = /foreign affairs school|外事学校/i;
const officeNamePattern = /longhu|龙湖/i;

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
      name: "RUS-005 User",
      passwordHash,
    },
    update: {
      passwordHash,
      name: "RUS-005 User",
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

test("RUS-005 creates a two-leg school then office commute", async ({ page }) => {
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
  expect(trip?.targetArriveAt?.toISOString()).toBe(
    expectedOfficeArriveAt.toISOString()
  );
  expect(trip?.finalStopName).toMatch(officeNamePattern);
  expect(trip?.stops.length).toBeGreaterThanOrEqual(2);

  const stops = trip?.stops ?? [];
  const schoolStop = stops.find((stop) => schoolNamePattern.test(stop.name));
  const officeStop = stops[stops.length - 1];
  expect(schoolStop).toBeTruthy();
  expect(officeStop.name).toMatch(officeNamePattern);
  expect(stops.indexOf(schoolStop!)).toBeLessThan(stops.indexOf(officeStop));
  expect(schoolStop!.plannedStayMin).toBe(10);
  expect(schoolStop!.targetArriveAt).toBeTruthy();
  expect(schoolStop!.targetArriveAt!.getTime()).toBeLessThan(
    expectedOfficeArriveAt.getTime()
  );
  expect(officeStop.targetArriveAt?.toISOString()).toBe(
    expectedOfficeArriveAt.toISOString()
  );
  expect(trip?.legs.length).toBeGreaterThanOrEqual(2);

  const schoolLeg = trip?.legs.find(
    (leg) => leg.destinationName === schoolStop!.name
  );
  const officeLeg = trip?.legs.find(
    (leg) => leg.destinationName === officeStop.name
  );
  expect(schoolLeg).toBeTruthy();
  expect(officeLeg).toBeTruthy();
  expect(schoolLeg!.originName).toBe("E2E Origin");
  expect(schoolLeg!.destinationName).toBe(schoolStop!.name);
  expect(schoolLeg!.targetArriveAt).toBeTruthy();
  expect(schoolLeg!.targetArriveAt!.getTime()).toBeLessThan(
    expectedOfficeArriveAt.getTime()
  );
  expect(schoolLeg!.selectedCandidate?.totalMinutes).toBeGreaterThan(0);
  expect(schoolLeg!.routeSegments.length).toBeGreaterThanOrEqual(1);
  expect(schoolLeg!.bufferComponents.length).toBeGreaterThanOrEqual(1);
  expect(schoolLeg!.reminderJobs).toHaveLength(6);

  expect(officeLeg!.originName).toBe(schoolStop!.name);
  expect(officeLeg!.destinationName).toBe(officeStop.name);
  expect(officeLeg!.targetArriveAt?.toISOString()).toBe(
    expectedOfficeArriveAt.toISOString()
  );
  expect(officeLeg!.selectedCandidate?.totalMinutes).toBeGreaterThan(0);
  expect(officeLeg!.routeSegments.length).toBeGreaterThanOrEqual(1);
  expect(officeLeg!.bufferComponents.length).toBeGreaterThanOrEqual(1);
  expect(officeLeg!.reminderJobs).toHaveLength(6);

  expect(trip?.reminderJobs).toHaveLength((trip?.legs.length ?? 0) * 6);
});
