import { expect, test } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { SESSION_COOKIE } from "../../src/lib/auth/session";
import { ensureTestDatabase } from "../integration/test-db";

const email = "user@example.com";
const password = "password";
process.env.DATABASE_URL ??= "file:./e2e-test.db";

let prisma: typeof PrismaInstance;

test.beforeAll(async () => {
  const [{ hashPassword }, db] = await Promise.all([
    import("../../src/lib/auth/password"),
    import("../../src/lib/db"),
  ]);
  prisma = db.prisma;
  const passwordHash = await hashPassword(password);

  await ensureTestDatabase();
  await prisma.session.deleteMany();
  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: "RUS-001 User",
      passwordHash,
    },
    update: {
      passwordHash,
      name: "RUS-001 User",
    },
  });
});

test.afterAll(async () => {
  await prisma?.$disconnect();
});

test("RUS-001 protects pages and persists login sessions", async ({ page }) => {
  const protectedPages = [
    "/",
    "/history",
    "/memories",
    "/settings",
    "/trips/not-a-real-trip",
    "/agent/not-a-real-session",
  ];

  for (const path of protectedPages) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }

  const settingsResponse = await page.request.get("/api/settings");
  expect(settingsResponse.status()).toBe(401);

  const agentResponse = await page.request.post("/api/agent-sessions", {
    data: { prompt: "arrive at Longhu Tianjie tomorrow at 9:15" },
  });
  expect(agentResponse.status()).toBe(401);

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("wrong-password");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('[role="alert"]')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL("/");

  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === SESSION_COOKIE
  );
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe("Lax");

  await page.reload();
  await expect(page).toHaveURL("/");

  const logoutStatus = await page.evaluate(async () => {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    return response.status;
  });
  expect(logoutStatus).toBe(200);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
