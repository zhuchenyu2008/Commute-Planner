import { expect, test } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { ensureTestDatabase } from "../integration/test-db";

const email = "rus-013@example.com";
const password = "password";
const prompt = "2026-07-03 09:00 arrive at Longhu Tianjie";
process.env.DATABASE_URL ??= "file:./e2e-test.db";
const agentRedirectTimeoutMs = Number(
  process.env.AGENT_REDIRECT_TIMEOUT_MS ?? 60_000
);
const schedulerTickTimeoutMs = Number(
  process.env.RUS_013_TICK_TIMEOUT_MS ?? 240_000
);
const schedulerSecret = process.env.SCHEDULER_TICK_SECRET ?? "rus-013-secret";
test.setTimeout(Number(process.env.RUS_013_TIMEOUT_MS ?? 600_000));

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
      name: "RUS-013 User",
      passwordHash,
    },
    update: {
      passwordHash,
      name: "RUS-013 User",
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
      routeChangeThresholdMinutes: 3,
    },
    update: {
      defaultCity: env.defaultCity,
      timezone: env.defaultTimezone,
      originName: "E2E Origin",
      originLngLat: "121.5230315924,29.8652491273",
      routeChangeThresholdMinutes: 3,
    },
  });
});

test.afterAll(async () => {
  await prisma?.$disconnect();
});

test("RUS-013 rechecks a fresh route through the authorized scheduler tick without sending a route-change notification", async ({
  page,
  request,
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

  const trip = await prisma.trip.findFirstOrThrow({
    where: { userId, rawPrompt: prompt },
    orderBy: { createdAt: "desc" },
    include: {
      legs: {
        orderBy: { order: "asc" },
        include: { selectedCandidate: true },
      },
      reminderJobs: { orderBy: { scheduledFor: "asc" } },
    },
  });
  const leg = trip.legs[0];
  expect(trip.status).toBe("monitoring");
  expect(trip.agentSessionId).toBeTruthy();
  expect(leg?.selectedCandidate?.totalMinutes).toBeGreaterThan(0);

  const dueRecheck = await prisma.reminderJob.findFirstOrThrow({
    where: {
      tripId: trip.id,
      legId: leg.id,
      kind: "recheck",
      status: "scheduled",
    },
    orderBy: { scheduledFor: "asc" },
  });
  await prisma.reminderJob.update({
    where: { id: dueRecheck.id },
    data: { scheduledFor: new Date(Date.now() - 1_000) },
  });

  const response = await request.post("/api/scheduler/tick", {
    headers: { authorization: `Bearer ${schedulerSecret}` },
    timeout: schedulerTickTimeoutMs,
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    processed: number;
    skipped: number;
    sent: number;
    failed: number;
  };
  expect(body.processed).toBeGreaterThanOrEqual(1);
  expect(body.skipped).toBeGreaterThanOrEqual(1);
  expect(body.sent).toBe(0);
  expect(body.failed).toBe(0);

  await expect(
    prisma.reminderJob.findUniqueOrThrow({ where: { id: dueRecheck.id } })
  ).resolves.toMatchObject({
    status: "skipped",
    attempts: 1,
  });
  await expect(
    prisma.recalculationLog.findFirstOrThrow({
      where: {
        tripId: trip.id,
        trigger: "recheck",
      },
    })
  ).resolves.toMatchObject({
    status: "skipped",
  });
  await expect(
    prisma.notificationLog.count({
      where: {
        tripId: trip.id,
        dedupeKey: { contains: ":route_change:" },
      },
    })
  ).resolves.toBe(0);

  const scheduledReminders = await prisma.reminderJob.findMany({
    where: {
      tripId: trip.id,
      status: "scheduled",
    },
  });
  expect(scheduledReminders.length).toBeGreaterThanOrEqual(1);
});
