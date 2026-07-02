import { expect, test } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { ensureTestDatabase } from "../integration/test-db";

const email = "rus-006@example.com";
const password = "password";
const prompt =
  "2026-07-03 08:40 first buy coffee near station, stay 8 minutes, then arrive Longhu Tianjie by 09:30";
const expectedLonghuArriveAt = new Date("2026-07-03T01:30:00.000Z");
process.env.DATABASE_URL ??= "file:./e2e-test.db";
const agentRedirectTimeoutMs = Number(
  process.env.AGENT_REDIRECT_TIMEOUT_MS ?? 60_000
);
const longhuNamePattern = /longhu|龙湖/i;

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
      name: "RUS-006 User",
      passwordHash,
    },
    update: {
      passwordHash,
      name: "RUS-006 User",
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

test("RUS-006 creates an errand stop with stay duration before final destination", async ({
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
    expectedLonghuArriveAt.toISOString()
  );
  expect(trip?.finalStopName).toMatch(longhuNamePattern);
  expect(trip?.stops.length).toBeGreaterThanOrEqual(2);

  const stops = trip?.stops ?? [];
  const coffeeStop = stops.find(
    (stop) => stop.kind === "coffee" || stop.plannedStayMin === 8
  );
  const finalStop = stops[stops.length - 1];
  expect(coffeeStop).toBeTruthy();
  expect(finalStop.name).toMatch(longhuNamePattern);
  expect(coffeeStop!.plannedStayMin).toBe(8);
  expect(coffeeStop!.targetArriveAt).toBeTruthy();
  expect(finalStop.targetArriveAt?.toISOString()).toBe(
    expectedLonghuArriveAt.toISOString()
  );
  expect(trip?.legs.length).toBeGreaterThanOrEqual(2);

  const coffeeLeg = trip?.legs.find(
    (leg) => leg.destinationName === coffeeStop!.name
  );
  const longhuLeg = trip?.legs.find(
    (leg) => leg.destinationName === finalStop.name
  );
  expect(coffeeLeg).toBeTruthy();
  expect(longhuLeg).toBeTruthy();
  expect(coffeeLeg!.originName).toBe("E2E Origin");
  expect(coffeeLeg!.destinationName).toBe(coffeeStop!.name);
  expect(coffeeLeg!.selectedCandidate?.totalMinutes).toBeGreaterThan(0);
  expect(coffeeLeg!.routeSegments.length).toBeGreaterThanOrEqual(1);
  expect(coffeeLeg!.bufferComponents.length).toBeGreaterThanOrEqual(1);
  expect(coffeeLeg!.reminderJobs).toHaveLength(6);

  expect(longhuLeg!.originName).toBe(coffeeStop!.name);
  expect(longhuLeg!.destinationName).toBe(finalStop.name);
  expect(longhuLeg!.destinationName).toMatch(longhuNamePattern);
  expect(longhuLeg!.selectedCandidate?.totalMinutes).toBeGreaterThan(0);
  expect(longhuLeg!.routeSegments.length).toBeGreaterThanOrEqual(1);
  expect(longhuLeg!.bufferComponents.length).toBeGreaterThanOrEqual(1);
  expect(longhuLeg!.reminderJobs).toHaveLength(6);

  expect(trip?.reminderJobs).toHaveLength((trip?.legs.length ?? 0) * 6);
});
