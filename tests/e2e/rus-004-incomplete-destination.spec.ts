import { expect, test } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { ensureTestDatabase } from "../integration/test-db";

const email = "rus-004@example.com";
const password = "password";
const prompt = "go to Longhu";
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
      name: "RUS-004 User",
      passwordHash,
    },
    update: {
      passwordHash,
      name: "RUS-004 User",
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

test("RUS-004 handles an incomplete arrival-time prompt without broken trip data", async ({
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

  const session = await prisma.agentSession.findFirst({
    where: { userId, prompt },
    orderBy: { createdAt: "desc" },
  });
  expect(session?.status).toBe("completed");

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
        },
      },
    },
  });

  expect(trip).toBeTruthy();
  expect(trip?.status).toBe("monitoring");
  expect(trip?.finalStopName?.trim().length).toBeGreaterThan(0);
  expect(trip?.stops.length).toBeGreaterThanOrEqual(1);
  expect(trip?.legs).toHaveLength(1);

  const leg = trip?.legs[0];
  expect(leg?.originName).toBe("E2E Origin");
  expect(leg?.destinationName.trim().length).toBeGreaterThan(0);
  expect(leg?.selectedCandidate?.totalMinutes).toBeGreaterThan(0);
  expect(leg?.routeSegments.length).toBeGreaterThanOrEqual(1);
  expect(leg?.bufferComponents.length).toBeGreaterThanOrEqual(1);
});
