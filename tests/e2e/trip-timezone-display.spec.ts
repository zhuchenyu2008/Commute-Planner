import { expect, test } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { createPlannedTrip } from "../../src/lib/trips/create-trip";
import { ensureTestDatabase } from "../integration/test-db";

const email = "timezone-display@example.com";
const password = "password";
const targetArriveAt = new Date("2026-07-03T04:30:00.000Z");
const latestDepartAt = new Date("2026-07-03T04:05:00.000Z");
const createdAt = new Date("2026-07-02T11:33:00.000Z");
process.env.DATABASE_URL ??= "file:./e2e-test.db";

let prisma: typeof PrismaInstance;
let userId: string;
let tripId: string;

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
      name: "Timezone Display User",
      passwordHash,
    },
    update: {
      passwordHash,
      name: "Timezone Display User",
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
      timezone: "Asia/Shanghai",
      originName: "E2E Origin",
      originLngLat: "121.5230315924,29.8652491273",
    },
    update: {
      defaultCity: env.defaultCity,
      timezone: "Asia/Shanghai",
      originName: "E2E Origin",
      originLngLat: "121.5230315924,29.8652491273",
    },
  });

  const trip = await createPlannedTrip({
    userId,
    rawPrompt: "明天中午12点半到外事学校",
    timezone: "Asia/Shanghai",
    title: "E2E Origin 到 外事学校",
    finalStopName: "外事学校",
    targetArriveAt,
    stops: [
      {
        order: 1,
        name: "外事学校",
        lngLat: "121.556,29.875",
        kind: "destination",
        targetArriveAt,
      },
    ],
    legs: [
      {
        order: 1,
        originName: "E2E Origin",
        originLngLat: "121.5230315924,29.8652491273",
        destinationName: "外事学校",
        destinationLngLat: "121.556,29.875",
        targetArriveAt,
        routeMinutes: 20,
        bufferMinutes: 5,
        totalMinutes: 25,
        latestDepartAt,
        bufferComponents: [
          {
            category: "transfer",
            label: "缓冲",
            minutes: 5,
            reason: "预留进校时间。",
          },
        ],
      },
    ],
  });
  await prisma.trip.update({
    where: { id: trip.id },
    data: { createdAt },
  });
  tripId = trip.id;
});

test.afterAll(async () => {
  await prisma?.$disconnect();
});

test("trip detail and history render stored UTC times in the trip timezone", async ({
  page,
}) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL("/");

  await page.goto(`/trips/${tripId}`);
  const detailText = (await page.locator("body").textContent()) ?? "";
  expect(detailText).toContain("目标到达");
  expect(detailText).toContain("12:30");
  expect(detailText).toContain("12:05");
  expect(detailText).not.toContain("04:30");
  expect(detailText).not.toContain("04:05");

  await page.goto("/history?date=2026-07-02");
  const cardText =
    (await page.locator(`a[href="/trips/${tripId}"]`).textContent()) ?? "";
  expect(cardText).toContain("目标到达");
  expect(cardText).toContain("12:30");
  expect(cardText).toContain("创建于");
  expect(cardText).toContain("19:33");
  expect(cardText).not.toContain("11:33");
});
