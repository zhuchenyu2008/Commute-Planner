import { expect, test } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { ensureTestDatabase } from "../integration/test-db";

const email = "rus-002@example.com";
const password = "password";
const prompt = "arrive at Longhu Tianjie tomorrow at 9:15";
process.env.DATABASE_URL ??= "file:./e2e-test.db";

let prisma: typeof PrismaInstance;
let userId: string;

test.beforeAll(async () => {
  const [{ hashPassword }, db] = await Promise.all([
    import("../../src/lib/auth/password"),
    import("../../src/lib/db"),
  ]);
  prisma = db.prisma;
  const passwordHash = await hashPassword(password);

  await ensureTestDatabase();
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: "RUS-002 User",
      passwordHash,
    },
    update: {
      passwordHash,
      name: "RUS-002 User",
    },
  });
  userId = user.id;

  await prisma.session.deleteMany({ where: { userId } });
  await prisma.agentSession.deleteMany({ where: { userId } });
  await prisma.userSettings.deleteMany({ where: { userId } });
});

test.afterAll(async () => {
  await prisma?.$disconnect();
});

test("RUS-002 requires default origin before planning and allows setup", async ({
  page,
}) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL("/");

  await page.locator(".agent-prompt-source input").fill(prompt);
  await page.locator(".agent-prompt-source button[type='submit']").click();
  await expect(page).toHaveURL(/\/settings$/);

  await expect
    .poll(() => prisma.agentSession.count({ where: { userId } }))
    .toBe(0);

  await page.locator('input[type="search"]').fill("E2E Origin");
  await page.locator("div:has(> input[type='search']) > button").click();
  await expect(page.locator("button:has(span.block.font-bold)").first()).toBeVisible();
  await page.locator("button:has(span.block.font-bold)").first().click();
  await page.locator("form button[type='submit']").click();

  const savedSettings = await page.evaluate(async () => {
    const response = await fetch("/api/settings");
    return response.json();
  });
  expect(savedSettings.settings.originName).toBeTruthy();
  expect(savedSettings.settings.originLngLat).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);

  await page.goto("/");
  await page.locator(".agent-prompt-source input").fill(prompt);
  await page.locator(".agent-prompt-source button[type='submit']").click();
  await page.waitForURL(/\/agent\/[^/]+$/, { timeout: 10_000 });

  const createdSession = await prisma.agentSession.findFirst({
    where: { userId, prompt },
    orderBy: { createdAt: "desc" },
  });

  expect(createdSession).toBeTruthy();
  expect(createdSession?.status).toMatch(/running|completed/);
});
