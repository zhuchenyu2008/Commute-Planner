import { expect, test, type Page } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { ensureTestDatabase } from "../integration/test-db";

process.env.DATABASE_URL ??= "file:./subagent-d-history-ui-e2e.db";

const email = "rus-022-025@example.com";
const password = "password";

let prisma: typeof PrismaInstance;
let userId: string;

type SeededTrip = {
  id: string;
  title: string;
};

const trips: Record<string, SeededTrip> = {};
const candidates: Record<string, string> = {};

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const loginResponse = page.waitForResponse((response) =>
    response.url().includes("/api/auth/login")
  );
  await page.locator('button[type="submit"]').click();
  await expect((await loginResponse).status()).toBe(200);
  await page.goto("/");
  await expect(page).toHaveURL("/");
}

async function createTrip(input: {
  key: string;
  title: string;
  status: string;
  finalStopName: string;
  createdAt: string;
  updatedAt?: string;
  targetArriveAt?: string | null;
  reminders?: boolean;
  selectedCandidate?: boolean;
  routeCandidates?: boolean;
  secondLeg?: boolean;
  recalculation?: boolean;
}) {
  const createdAt = new Date(input.createdAt);
  const updatedAt = new Date(input.updatedAt ?? input.createdAt);
  const targetArriveAt =
    input.targetArriveAt === null
      ? null
      : new Date(input.targetArriveAt ?? "2026-07-03T01:00:00.000Z");

  const trip = await prisma.trip.create({
    data: {
      userId,
      title: input.title,
      rawPrompt: input.title,
      status: input.status,
      timezone: "Asia/Shanghai",
      finalStopName: input.finalStopName,
      targetArriveAt,
      createdAt,
      updatedAt,
    },
  });

  const origin = await prisma.tripStop.create({
    data: {
      tripId: trip.id,
      order: 0,
      kind: "origin",
      name: `${input.title} Origin`,
      lngLat: "121.5230315924,29.8652491273",
      createdAt,
      updatedAt,
    },
  });
  const destination = await prisma.tripStop.create({
    data: {
      tripId: trip.id,
      order: 1,
      kind: "destination",
      name: input.finalStopName,
      lngLat: "121.6000000000,29.9000000000",
      targetArriveAt,
      createdAt,
      updatedAt,
    },
  });
  const leg = await prisma.tripLeg.create({
    data: {
      tripId: trip.id,
      order: 0,
      fromStopId: origin.id,
      toStopId: destination.id,
      originName: origin.name,
      originLngLat: origin.lngLat ?? "",
      destinationName: destination.name,
      destinationLngLat: destination.lngLat,
      targetArriveAt,
      latestDepartAt: new Date("2026-07-03T00:20:00.000Z"),
      status: input.status === "cancelled" ? "cancelled" : "monitoring",
      createdAt,
      updatedAt,
    },
  });

  if (input.routeCandidates !== false) {
    const candidate = await prisma.routeCandidate.create({
      data: {
        legId: leg.id,
        key: `${input.key}-candidate-1`,
        title: `${input.title} Candidate Fallback Option`,
        mode: "transit",
        routeMinutes: 25,
        bufferMinutes: 10,
        totalMinutes: 35,
        selected: input.selectedCandidate !== false,
        rationale: "Seeded deterministic candidate.",
        createdAt,
      },
    });

    await prisma.routeSegment.create({
      data: {
        legId: leg.id,
        candidateId: candidate.id,
        order: 0,
        mode: "walk",
        title: `${input.title} Walk Segment`,
        detail: "Seeded segment detail",
        minutes: 5,
      },
    });
    await prisma.bufferComponent.create({
      data: {
        legId: leg.id,
        order: 0,
        category: "safety",
        label: `${input.title} Buffer`,
        minutes: 10,
        reason: "Seeded buffer reason.",
      },
    });

    if (input.selectedCandidate !== false) {
      await prisma.tripLeg.update({
        where: { id: leg.id },
        data: { selectedCandidateId: candidate.id },
      });
    }
  }

  if (input.reminders) {
    await prisma.reminderJob.create({
      data: {
        tripId: trip.id,
        legId: leg.id,
        kind: "depart_now",
        scheduledFor: new Date("2026-07-03T00:20:00.000Z"),
        status: input.status === "cancelled" ? "cancelled" : "scheduled",
        dedupeKey: `${trip.id}:depart_now:0`,
        payloadJson: "{}",
      },
    });
  }

  if (input.recalculation) {
    await prisma.recalculationLog.create({
      data: {
        tripId: trip.id,
        legId: leg.id,
        trigger: "scheduler",
        status: "updated",
        summary: `${input.title} latest recalculation summary`,
        createdAt: new Date("2026-07-02T12:00:00.000Z"),
      },
    });
  }

  if (input.secondLeg) {
    const secondStop = await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        order: 2,
        kind: "destination",
        name: `${input.title} Second Destination`,
        lngLat: "121.7000000000,29.9500000000",
        targetArriveAt,
        createdAt,
        updatedAt,
      },
    });
    const secondLeg = await prisma.tripLeg.create({
      data: {
        tripId: trip.id,
        order: 1,
        fromStopId: destination.id,
        toStopId: secondStop.id,
        originName: destination.name,
        originLngLat: destination.lngLat ?? "",
        destinationName: secondStop.name,
        destinationLngLat: secondStop.lngLat,
        targetArriveAt,
        latestDepartAt: new Date("2026-07-03T00:45:00.000Z"),
        status: "monitoring",
        createdAt,
        updatedAt,
      },
    });
    const secondCandidate = await prisma.routeCandidate.create({
      data: {
        legId: secondLeg.id,
        key: `${input.key}-candidate-2`,
        title: `${input.title} Second Selected Candidate`,
        mode: "metro",
        routeMinutes: 18,
        bufferMinutes: 6,
        totalMinutes: 24,
        selected: true,
        rationale: "Seeded second leg candidate.",
        createdAt,
      },
    });
    await prisma.tripLeg.update({
      where: { id: secondLeg.id },
      data: { selectedCandidateId: secondCandidate.id },
    });
    await prisma.routeSegment.create({
      data: {
        legId: secondLeg.id,
        candidateId: secondCandidate.id,
        order: 0,
        mode: "metro",
        title: `${input.title} Second Leg Segment`,
        detail: "Seeded second leg detail",
        minutes: 18,
      },
    });
  }

  trips[input.key] = { id: trip.id, title: input.title };
  return trip;
}

test.beforeAll(async () => {
  const [{ hashPassword }, db] = await Promise.all([
    import("../../src/lib/auth/password"),
    import("../../src/lib/db"),
  ]);
  prisma = db.prisma;

  await ensureTestDatabase();
  await prisma.user.deleteMany({ where: { email } });

  const user = await prisma.user.create({
    data: {
      email,
      name: "RUS-022-025 User",
      passwordHash: await hashPassword(password),
      settings: {
        create: {
          defaultCity: "Ningbo",
          timezone: "Asia/Shanghai",
          originName: "Batch D Origin",
          originLngLat: "121.5230315924,29.8652491273",
        },
      },
    },
  });
  userId = user.id;

  const pendingConfirm = await prisma.memoryCandidate.create({
    data: {
      userId,
      kind: "preference",
      label: "Prefers metro for rainy mornings",
      valueJson: JSON.stringify({ mode: "metro", weather: "rain" }),
      createdAt: new Date("2026-07-02T01:00:00.000Z"),
    },
  });
  const pendingIgnore = await prisma.memoryCandidate.create({
    data: {
      userId,
      kind: "avoidance",
      label: "Avoids a temporary construction gate",
      valueJson: JSON.stringify({ avoid: "construction gate" }),
      createdAt: new Date("2026-07-02T01:05:00.000Z"),
    },
  });
  candidates.confirm = pendingConfirm.id;
  candidates.ignore = pendingIgnore.id;

  await createTrip({
    key: "historyJul1",
    title: "RUS-022 BJ Jul 01 23:55",
    status: "completed",
    finalStopName: "History Stop Jul 01",
    createdAt: "2026-07-01T15:55:00.000Z",
    updatedAt: "2026-07-01T15:55:00.000Z",
    targetArriveAt: "2026-07-01T16:20:00.000Z",
    selectedCandidate: true,
  });
  await createTrip({
    key: "historyJul2Early",
    title: "RUS-022 BJ Jul 02 00:05",
    status: "monitoring",
    finalStopName: "History Stop Jul 02 Early",
    createdAt: "2026-07-01T16:05:00.000Z",
    updatedAt: "2026-07-01T16:05:00.000Z",
    targetArriveAt: "2026-07-02T01:00:00.000Z",
    selectedCandidate: true,
  });
  await createTrip({
    key: "historyJul2Late",
    title: "RUS-022 BJ Jul 02 23:59",
    status: "scheduled",
    finalStopName: "History Stop Jul 02 Late",
    createdAt: "2026-07-02T15:59:00.000Z",
    updatedAt: "2026-07-02T15:59:00.000Z",
    targetArriveAt: "2026-07-03T01:00:00.000Z",
    selectedCandidate: true,
  });
  await createTrip({
    key: "completed",
    title: "RUS-024 Completed Latest",
    status: "completed",
    finalStopName: "Completed Home Stop",
    createdAt: "2026-07-02T02:00:00.000Z",
    updatedAt: "2026-07-02T02:00:00.000Z",
    selectedCandidate: true,
  });
  await createTrip({
    key: "cancelled",
    title: "RUS-024 Cancelled Latest",
    status: "cancelled",
    finalStopName: "Cancelled Home Stop",
    createdAt: "2026-07-02T03:00:00.000Z",
    updatedAt: "2026-07-02T03:00:00.000Z",
    selectedCandidate: true,
    reminders: true,
  });
  await createTrip({
    key: "failed",
    title: "RUS-024 Failed Latest",
    status: "failed",
    finalStopName: "Failed Home Stop",
    createdAt: "2026-07-02T04:00:00.000Z",
    updatedAt: "2026-07-02T04:00:00.000Z",
    selectedCandidate: true,
  });
  await createTrip({
    key: "noReminders",
    title: "RUS-025 No Reminders",
    status: "monitoring",
    finalStopName: "No Reminder Detail Stop",
    createdAt: "2026-07-02T05:00:00.000Z",
    updatedAt: "2026-07-02T05:00:00.000Z",
    selectedCandidate: true,
    reminders: false,
  });
  await createTrip({
    key: "candidateFallback",
    title: "RUS-025 Candidate Fallback",
    status: "monitoring",
    finalStopName: "Candidate Fallback Stop",
    createdAt: "2026-07-02T06:00:00.000Z",
    updatedAt: "2026-07-02T06:00:00.000Z",
    selectedCandidate: false,
    routeCandidates: true,
  });
  await createTrip({
    key: "multiSelected",
    title: "RUS-025 Multi Selected",
    status: "monitoring",
    finalStopName: "Multi Selected Stop",
    createdAt: "2026-07-02T07:00:00.000Z",
    updatedAt: "2026-07-02T07:00:00.000Z",
    selectedCandidate: true,
    secondLeg: true,
  });
  await createTrip({
    key: "latestRecalc",
    title: "RUS-025 Latest Recalculation",
    status: "monitoring",
    finalStopName: "Recalculation Stop",
    createdAt: "2026-07-02T08:00:00.000Z",
    updatedAt: "2026-07-02T08:00:00.000Z",
    selectedCandidate: true,
    recalculation: true,
  });
  await createTrip({
    key: "scheduled",
    title: "RUS-024 Scheduled Latest",
    status: "scheduled",
    finalStopName: "Scheduled Home Stop",
    createdAt: "2026-07-02T09:00:00.000Z",
    updatedAt: "2026-07-02T09:00:00.000Z",
    selectedCandidate: true,
    reminders: true,
  });
  await createTrip({
    key: "monitoring",
    title: "RUS-024 Monitoring Latest",
    status: "monitoring",
    finalStopName: "Monitoring Home Stop",
    createdAt: "2026-07-02T10:00:00.000Z",
    updatedAt: "2026-07-02T10:00:00.000Z",
    selectedCandidate: true,
    reminders: true,
  });
});

test.afterAll(async () => {
  await prisma?.$disconnect();
});

test("RUS-022 filters history by Beijing calendar day and opens the selected trip", async ({
  page,
}) => {
  await login(page);

  await page.goto("/history?date=2026-07-01");
  await expect(page).toHaveURL(/date=2026-07-01/);
  await expect(page.getByText(trips.historyJul1.title)).toBeVisible();
  await expect(page.getByText(trips.historyJul2Early.title)).toHaveCount(0);

  await page.goto("/history?date=2026-07-02");
  await expect(page.getByText(trips.historyJul2Early.title)).toBeVisible();
  await expect(page.getByText(trips.historyJul2Late.title)).toBeVisible();
  await expect(page.getByText(trips.historyJul1.title)).toHaveCount(0);

  await page.goto("/history?date=2026-07-03");
  await expect(page.getByText(trips.historyJul1.title)).toHaveCount(0);
  await expect(page.getByText(trips.historyJul2Early.title)).toHaveCount(0);
  await expect(page.getByText(trips.historyJul2Late.title)).toHaveCount(0);

  await page.locator('form[action="/history"] button[type="button"]').first().click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('button[type="button"]').nth(1).click();
  await dialog.locator('button[type="button"]').first().click();
  await dialog.locator('button[type="button"]').filter({ hasText: /^2$/ }).first().click();
  await expect(page).toHaveURL(/date=2026-07-02/);

  await page.getByText(trips.historyJul2Early.title).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${trips.historyJul2Early.id}$`));
  await expect(page.getByRole("heading", { name: trips.historyJul2Early.title })).toBeVisible();
});

test("RUS-023 confirms and ignores memory candidates once", async ({ page }) => {
  await login(page);

  await page.goto("/memories");
  await expect(page.getByText("Prefers metro for rainy mornings")).toBeVisible();
  await expect(page.getByText("Avoids a temporary construction gate")).toBeVisible();

  const confirmCard = page
    .getByText("Prefers metro for rainy mornings")
    .locator('xpath=ancestor::div[contains(@class, "p-5")][1]');
  await confirmCard.getByRole("button").first().click();
  await expect(page.getByText("Prefers metro for rainy mornings")).toBeVisible();
  await expect
    .poll(async () =>
      prisma.memory.count({
        where: { userId, label: "Prefers metro for rainy mornings" },
      })
    )
    .toBe(1);

  const ignoreCard = page
    .getByText("Avoids a temporary construction gate")
    .locator('xpath=ancestor::div[contains(@class, "p-5")][1]');
  await ignoreCard.getByRole("button").nth(1).click();
  await expect(page.getByText("Avoids a temporary construction gate")).toHaveCount(0);
  await expect(
    prisma.memoryCandidate.findUnique({ where: { id: candidates.ignore } })
  ).resolves.toMatchObject({ status: "ignored" });

  const repeatConfirm = await page.request.post(
    `/api/memory-candidates/${candidates.confirm}/confirm`
  );
  const repeatIgnore = await page.request.post(
    `/api/memory-candidates/${candidates.ignore}/ignore`
  );
  expect(repeatConfirm.status()).toBe(409);
  expect(repeatIgnore.status()).toBe(409);

  await page.goto("/");
  await expect(page.getByText("Prefers metro for rainy mornings")).toBeVisible();
  await expect(
    prisma.memoryCandidate.count({ where: { userId, status: "pending" } })
  ).resolves.toBe(0);
});

test("RUS-024 renders home summary cards for empty, status, history, and memory states", async ({
  page,
}) => {
  const [{ hashPassword }] = await Promise.all([
    import("../../src/lib/auth/password"),
  ]);
  const emptyEmail = "rus-024-empty@example.com";
  await prisma.user.deleteMany({ where: { email: emptyEmail } });
  await prisma.user.create({
    data: {
      email: emptyEmail,
      name: "RUS-024 Empty User",
      passwordHash: await hashPassword(password),
      settings: {
        create: {
          defaultCity: "Ningbo",
          timezone: "Asia/Shanghai",
          originName: "Empty Home Origin",
          originLngLat: "121.5230315924,29.8652491273",
        },
      },
    },
  });

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(emptyEmail);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Empty Home Origin")).toBeVisible();
  await expect(page.getByText("Monitoring Home Stop")).toHaveCount(0);

  await page.evaluate(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
  });
  await login(page);

  for (const [key, stopName] of [
    ["scheduled", "Scheduled Home Stop"],
    ["monitoring", "Monitoring Home Stop"],
    ["completed", "Completed Home Stop"],
    ["cancelled", "Cancelled Home Stop"],
    ["failed", "Failed Home Stop"],
  ] as const) {
    await prisma.trip.updateMany({
      where: { userId },
      data: { updatedAt: new Date("2026-07-02T00:00:00.000Z") },
    });
    await prisma.trip.update({
      where: { id: trips[key].id },
      data: { updatedAt: new Date("2030-01-01T00:00:00.000Z") },
    });
    await page.goto("/");
    await expect(page.getByText(stopName).first()).toBeVisible();
    await expect(page.getByText(trips[key].title)).toBeVisible();
  }

  await expect(page.getByText("Prefers metro for rainy mornings")).toBeVisible();
});

test("RUS-025 renders trip detail for sparse and varied trip data shapes", async ({
  page,
}) => {
  await login(page);

  for (const key of [
    "noReminders",
    "candidateFallback",
    "multiSelected",
    "latestRecalc",
    "cancelled",
  ] as const) {
    await page.goto(`/trips/${trips[key].id}`);
    await expect(page.getByRole("heading", { name: trips[key].title })).toBeVisible();
  }

  await page.goto(`/trips/${trips.noReminders.id}`);
  await expect(page.getByText(`${trips.noReminders.title} Walk Segment`)).toBeVisible();

  await page.goto(`/trips/${trips.candidateFallback.id}`);
  await expect(
    page.getByText(`${trips.candidateFallback.title} Candidate Fallback Option`)
  ).toBeVisible();

  await page.goto(`/trips/${trips.multiSelected.id}`);
  await expect(
    page.getByText(`${trips.multiSelected.title} Second Leg Segment`)
  ).toBeVisible();

  await page.goto(`/trips/${trips.latestRecalc.id}`);
  await expect(
    page.getByText(`${trips.latestRecalc.title} latest recalculation summary`)
  ).toBeVisible();

  await page.goto(`/trips/${trips.cancelled.id}`);
  await expect(page.getByText("Cancelled Home Stop").first()).toBeVisible();
});
