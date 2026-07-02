import { expect, test, type Page } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { ensureTestDatabase } from "../integration/test-db";

process.env.DATABASE_URL ??= "file:./subagent-e-responsive-e2e.db";

const email = "rus-035-038@example.com";
const password = "password";
const longToken = "RUS037LongUnbrokenDestinationName".repeat(8);
const longStopName = `${longToken} Central Interchange With Extended Platform Notes`;
const longEmail = `${"responsive-overflow-user".repeat(6)}@example-commute-overflow.test`;
const longTelegramChatId = "99887766554433221100".repeat(6);

let prisma: typeof PrismaInstance;
let tripId: string;
let sessionId: string;

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL("/");
}

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => {
    const ignored = new Set(["SCRIPT", "STYLE", "META", "LINK"]);
    const offenders = Array.from(document.body.querySelectorAll("*"))
      .filter((element) => !ignored.has(element.tagName))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          className: element.className?.toString() ?? "",
          tagName: element.tagName,
          text: element.textContent?.trim().slice(0, 80) ?? "",
          left: rect.left,
          right: rect.right,
          width: rect.width,
          position: style.position,
        };
      })
      .filter((entry) => {
        if (entry.width === 0) return false;
        if (entry.position === "fixed") return false;
        return entry.left < -1 || entry.right > window.innerWidth + 1;
      })
      .slice(0, 8);

    return {
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      offenders,
    };
  });

  expect(metrics.offenders).toEqual([]);
  expect(
    Math.max(metrics.bodyScrollWidth, metrics.documentScrollWidth),
    JSON.stringify(metrics, null, 2)
  ).toBeLessThanOrEqual(metrics.innerWidth + 1);
}

async function expectNoVisibleOverlap(page: Page) {
  const overlaps = await page.evaluate(() => {
    const elements = Array.from(
      document.querySelectorAll("a, button, input, [role='group'], main p, main h1, main h2, main span")
    )
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          element,
          index,
          tagName: element.tagName,
          text: element.textContent?.trim().slice(0, 80) ?? "",
          rect,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none",
        };
      })
      .filter((entry) => entry.visible)
      .filter((entry) => entry.rect.bottom > 0 && entry.rect.top < window.innerHeight);

    const results: Array<{ a: string; b: string }> = [];
    for (let i = 0; i < elements.length; i += 1) {
      for (let j = i + 1; j < elements.length; j += 1) {
        const a = elements[i];
        const b = elements[j];
        if (a.element.contains(b.element) || b.element.contains(a.element)) {
          continue;
        }
        if (a.element.parentElement !== b.element.parentElement) {
          continue;
        }
        const horizontal = a.rect.left < b.rect.right - 2 && a.rect.right > b.rect.left + 2;
        const vertical = a.rect.top < b.rect.bottom - 2 && a.rect.bottom > b.rect.top + 2;
        if (!horizontal || !vertical) continue;

        const sameText = a.text && b.text && (a.text.includes(b.text) || b.text.includes(a.text));
        const sameControl =
          Math.abs(a.rect.left - b.rect.left) < 2 &&
          Math.abs(a.rect.right - b.rect.right) < 2 &&
          Math.abs(a.rect.top - b.rect.top) < 2 &&
          Math.abs(a.rect.bottom - b.rect.bottom) < 2;
        if (!sameText && !sameControl) {
          results.push({
            a: `${a.tagName}:${a.text}`,
            b: `${b.tagName}:${b.text}`,
          });
        }
      }
    }
    return results.slice(0, 5);
  });

  expect(overlaps).toEqual([]);
}

async function expectMobileBottomPadding(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const metrics = await page.evaluate(() => {
    const nav = document.querySelector("nav.fixed.inset-x-0.bottom-0");
    const main = document.querySelector("main");
    const lastContent = main?.lastElementChild;
    return {
      lastBottom: lastContent?.getBoundingClientRect().bottom ?? 0,
      navTop: nav?.getBoundingClientRect().top ?? window.innerHeight,
    };
  });

  expect(metrics.lastBottom).toBeLessThanOrEqual(metrics.navTop + 1);
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
      name: "RUS-035-038 Responsive User",
      passwordHash: await hashPassword(password),
      settings: {
        create: {
          defaultCity: "Ningbo",
          timezone: "Asia/Shanghai",
          originName: "RUS Responsive Origin",
          originLngLat: "121.5230315924,29.8652491273",
          routePreference: "balanced",
          telegramChatId: longTelegramChatId,
          emailRecipient: longEmail,
        },
      },
    },
  });

  const trip = await prisma.trip.create({
    data: {
      userId: user.id,
      title: `RUS-037 ${longStopName}`,
      rawPrompt: `Plan commute to ${longStopName}`,
      status: "monitoring",
      timezone: "Asia/Shanghai",
      finalStopName: longStopName,
      targetArriveAt: new Date("2026-07-03T01:00:00.000Z"),
      createdAt: new Date("2026-07-02T02:00:00.000Z"),
      updatedAt: new Date("2026-07-02T02:00:00.000Z"),
    },
  });
  tripId = trip.id;

  const origin = await prisma.tripStop.create({
    data: {
      tripId,
      order: 0,
      kind: "origin",
      name: "RUS Responsive Origin",
      lngLat: "121.5230315924,29.8652491273",
    },
  });
  const stopover = await prisma.tripStop.create({
    data: {
      tripId,
      order: 1,
      kind: "stopover",
      name: `${longToken} Stopover With Coffee Pickup And Parent Dropoff`,
      lngLat: "121.6000000000,29.9000000000",
      plannedStayMin: 8,
    },
  });
  const destination = await prisma.tripStop.create({
    data: {
      tripId,
      order: 2,
      kind: "destination",
      name: longStopName,
      lngLat: "121.7000000000,29.9500000000",
      targetArriveAt: new Date("2026-07-03T01:00:00.000Z"),
    },
  });

  const firstLeg = await prisma.tripLeg.create({
    data: {
      tripId,
      order: 0,
      fromStopId: origin.id,
      toStopId: stopover.id,
      originName: origin.name,
      originLngLat: origin.lngLat ?? "",
      destinationName: stopover.name,
      destinationLngLat: stopover.lngLat,
      latestDepartAt: new Date("2026-07-03T00:10:00.000Z"),
      status: "monitoring",
    },
  });
  const firstCandidate = await prisma.routeCandidate.create({
    data: {
      legId: firstLeg.id,
      key: "rus-037-long-first",
      title: `${longToken} Selected Transit Candidate With A Very Long Name`,
      mode: "transit",
      routeMinutes: 28,
      bufferMinutes: 7,
      totalMinutes: 35,
      selected: true,
      rationale: "Deterministic responsive route candidate.",
    },
  });
  await prisma.tripLeg.update({
    where: { id: firstLeg.id },
    data: { selectedCandidateId: firstCandidate.id },
  });
  await prisma.routeSegment.create({
    data: {
      legId: firstLeg.id,
      candidateId: firstCandidate.id,
      order: 0,
      mode: "walk",
      title: `${longToken} Walk Along Extended Concourse Name`,
      detail: `${longToken} detail should wrap instead of forcing horizontal scroll.`,
      minutes: 9,
    },
  });
  await prisma.bufferComponent.create({
    data: {
      legId: firstLeg.id,
      order: 0,
      category: "safety",
      label: `${longToken} Buffer Label`,
      minutes: 7,
      reason: `${longToken} buffer reason should wrap within the card.`,
    },
  });

  const secondLeg = await prisma.tripLeg.create({
    data: {
      tripId,
      order: 1,
      fromStopId: stopover.id,
      toStopId: destination.id,
      originName: stopover.name,
      originLngLat: stopover.lngLat ?? "",
      destinationName: destination.name,
      destinationLngLat: destination.lngLat,
      targetArriveAt: new Date("2026-07-03T01:00:00.000Z"),
      latestDepartAt: new Date("2026-07-03T00:35:00.000Z"),
      status: "monitoring",
    },
  });
  const secondCandidate = await prisma.routeCandidate.create({
    data: {
      legId: secondLeg.id,
      key: "rus-037-long-second",
      title: "Second leg selected candidate",
      mode: "metro",
      routeMinutes: 19,
      bufferMinutes: 6,
      totalMinutes: 25,
      selected: true,
      rationale: "Deterministic second route candidate.",
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
      title: "Metro segment with stable minute badge",
      detail: `${longToken} second leg detail remains readable.`,
      minutes: 19,
    },
  });
  await prisma.bufferComponent.create({
    data: {
      legId: secondLeg.id,
      order: 0,
      category: "weather",
      label: "Weather buffer",
      minutes: 6,
      reason: `${longToken} weather context remains wrapped.`,
      source: "weather_context",
    },
  });
  await prisma.reminderJob.create({
    data: {
      tripId,
      legId: firstLeg.id,
      kind: "depart_now",
      scheduledFor: new Date("2026-07-03T00:10:00.000Z"),
      status: "scheduled",
      dedupeKey: `${tripId}:responsive:depart-now`,
      payloadJson: "{}",
    },
  });

  const session = await prisma.agentSession.create({
    data: {
      userId: user.id,
      tripId,
      status: "completed",
      purpose: "planning",
      prompt: `Plan ${longStopName}`,
    },
  });
  sessionId = session.id;
  await prisma.agentMessage.createMany({
    data: [
      {
        agentSessionId: sessionId,
        role: "user",
        content: `Please plan a route to ${longStopName}`,
      },
      {
        agentSessionId: sessionId,
        role: "assistant",
        content: `${longToken} assistant reply is intentionally long and should wrap cleanly inside the Agent timeline without overlapping controls.`,
      },
    ],
  });
});

test.afterAll(async () => {
  await prisma?.$disconnect();
});

test("RUS-035 desktop navigation stays visible, active, and below the fixed header", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const desktopHeader = page.locator("header.fixed.inset-x-0.top-0");

  for (const [path, route] of [
    ["/", "home"],
    ["/history", "history"],
    ["/memories", "memories"],
    ["/settings", "settings"],
  ] as const) {
    await page.goto(path);
    await expect(desktopHeader).toBeVisible();
    await expect(page.locator(`main[data-page-route="${route}"]`)).toBeVisible();

    const activeLinkColor = await page
      .locator(`header.fixed.inset-x-0.top-0 nav a[href="${path}"]`)
      .evaluate((element) => window.getComputedStyle(element).color);
    expect(activeLinkColor).toBe("rgb(37, 99, 235)");

    const layout = await page.evaluate(() => {
      const header = document
        .querySelector("header.fixed.inset-x-0.top-0")
        ?.getBoundingClientRect();
      const firstContent = document
        .querySelector("main")
        ?.firstElementChild?.getBoundingClientRect();
      return {
        headerBottom: header?.bottom ?? 0,
        firstContentTop: firstContent?.top ?? 0,
      };
    });
    expect(layout.firstContentTop).toBeGreaterThanOrEqual(layout.headerBottom);
    await expectNoHorizontalOverflow(page);
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/trips/${tripId}`);
  await expect(desktopHeader).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("RUS-036 mobile navigation is usable and content avoids horizontal scroll", async ({
  page,
}) => {
  await login(page);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 375, height: 667 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    for (const path of ["/", "/settings", "/history", `/agent/${sessionId}`, `/trips/${tripId}`]) {
      await page.goto(path);
      await expect(page.locator("nav.fixed.inset-x-0.bottom-0")).toBeVisible();
      await expect(page.locator("header.fixed.inset-x-0.top-0")).toBeHidden();
      await expectNoHorizontalOverflow(page);
      await expectMobileBottomPadding(page);
    }
  }
});

test("RUS-037 long text wraps without overlap and controls keep stable dimensions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  await page.goto("/settings");
  const telegramButtonSize = await page
    .locator('button[type="button"]')
    .filter({ has: page.locator("svg") })
    .last()
    .boundingBox();
  await expect(page.locator('input[name="telegramChatId"]')).toHaveValue(longTelegramChatId);
  await expect(page.locator('input[name="emailRecipient"]')).toHaveValue(longEmail);
  await expectNoHorizontalOverflow(page);

  await page.goto(`/agent/${sessionId}`);
  await expect(page.getByText(longToken, { exact: false }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoVisibleOverlap(page);

  await page.goto(`/trips/${tripId}`);
  await expect(page.getByText(longStopName, { exact: false }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoVisibleOverlap(page);

  await page.goto("/settings");
  const telegramButtonSizeAfter = await page
    .locator('button[type="button"]')
    .filter({ has: page.locator("svg") })
    .last()
    .boundingBox();
  expect(telegramButtonSizeAfter?.height).toBe(telegramButtonSize?.height);
});

test("RUS-038 keyboard navigation, focus, select controls, date picker, and Enter submit work", async ({
  page,
}) => {
  await page.goto("/login");
  await page.keyboard.press("Tab");
  await expect(page.locator('input[name="email"]')).toBeFocused();
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await expect(page.locator('input[name="password"]')).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/");

  await page.goto("/settings");
  const timezoneButton = page.locator("#timezone");
  await timezoneButton.focus();
  await expect(timezoneButton).toBeFocused();
  await page.keyboard.press("Space");
  await expect(timezoneButton).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(timezoneButton).toHaveAttribute("aria-expanded", "false");

  const routePreferenceButton = page.locator("#routePreference");
  await routePreferenceButton.focus();
  await page.keyboard.press("Enter");
  await expect(routePreferenceButton).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(routePreferenceButton).toHaveAttribute("aria-expanded", "false");

  await page.locator('input[name="defaultCity"]').focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Ningbo Keyboard");
  await page.keyboard.press("Enter");
  await expect(page.locator('[role="status"]')).not.toBeEmpty();

  await page.goto("/history");
  const dateButton = page.locator('form[action="/history"] button[type="button"]').first();
  await dateButton.focus();
  await expect(dateButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator('[role="dialog"] button').first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/date=/);
});
