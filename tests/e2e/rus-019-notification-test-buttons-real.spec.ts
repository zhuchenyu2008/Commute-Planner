import { expect, test, type Page } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { ensureTestDatabase } from "../integration/test-db";

type NotificationResponse = {
  result?: {
    status?: string;
    recipient?: string | null;
    error?: string;
  };
  error?: string;
};

const runRealApiScenario = process.env.RUS_019_REAL_API === "1";
const runRealTelegramScenario = process.env.RUS_019_REAL_TELEGRAM === "1";
const telegramChatId = runRealTelegramScenario
  ? process.env.TELEGRAM_CHAT_ID?.trim()
  : undefined;
const emailRecipient =
  process.env.RUS_019_EMAIL_RECIPIENT?.trim() ||
  process.env.EMAIL_RECIPIENT?.trim() ||
  process.env.SMTP_USER?.trim();
const hasSmtpConfig =
  Boolean(process.env.SMTP_HOST?.trim()) &&
  Boolean(process.env.SMTP_USER?.trim()) &&
  Boolean((process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD)?.trim()) &&
  Boolean(emailRecipient);
const email = "rus-019-real@example.com";
const password = "password";

process.env.DATABASE_URL ??= "file:./e2e-test.db";
test.setTimeout(Number(process.env.RUS_019_TIMEOUT_MS ?? 120_000));
test.skip(
  !runRealApiScenario || (!telegramChatId && !hasSmtpConfig),
  "Set RUS_019_REAL_API=1 plus TELEGRAM_CHAT_ID or SMTP settings to execute real notification button coverage."
);

let prisma: typeof PrismaInstance;

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
      name: "RUS-019 Real API User",
      passwordHash,
    },
    update: {
      name: "RUS-019 Real API User",
      passwordHash,
    },
  });

  await prisma.session.deleteMany({ where: { userId: user.id } });
  if (telegramChatId) {
    await prisma.userSettings.updateMany({
      where: {
        telegramChatId,
        userId: { not: user.id },
      },
      data: { telegramChatId: null },
    });
  }
  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      defaultCity: "Ningbo",
      timezone: "Asia/Shanghai",
      originName: "E2E Origin",
      originLngLat: "121.5230315924,29.8652491273",
      telegramChatId: telegramChatId ?? null,
      emailRecipient,
    },
    update: {
      defaultCity: "Ningbo",
      timezone: "Asia/Shanghai",
      originName: "E2E Origin",
      originLngLat: "121.5230315924,29.8652491273",
      telegramChatId: telegramChatId ?? null,
      emailRecipient,
    },
  });
});

test.afterAll(async () => {
  await prisma?.$disconnect();
});

test("RUS-019 sends real notification test messages from the settings buttons", async ({
  page,
}) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL("/");

  await page.goto("/settings");
  await expect(page.locator('input[name="telegramChatId"]')).toHaveValue(
    telegramChatId ?? ""
  );
  await expect(page.locator('input[name="emailRecipient"]')).toHaveValue(
    emailRecipient ?? ""
  );

  const telegramButton = page.locator("input#telegramChatId + button");
  const emailButton = page.locator("input#emailRecipient + button");

  if (telegramChatId) {
    const payload = await clickNotificationButton(page, telegramButton);
    expect(payload.result?.status).toBe("sent");
    expect(payload.result?.recipient).toBe(telegramChatId);
  }

  if (hasSmtpConfig) {
    const payload = await clickNotificationButton(page, emailButton);
    expect(payload.result?.status).toBe("sent");
    expect(payload.result?.recipient).toBe(emailRecipient);
  }

  await expect(telegramButton).toBeEnabled();
  await expect(emailButton).toBeEnabled();
});

async function clickNotificationButton(
  page: Page,
  button: ReturnType<Page["locator"]>
) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/settings/test-notification") &&
      response.request().method() === "POST",
    { timeout: Number(process.env.RUS_019_BUTTON_TIMEOUT_MS ?? 90_000) }
  );

  await button.click();
  await expect(button).toBeDisabled();
  const response = await responsePromise;
  const payload = (await response.json()) as NotificationResponse;

  expect(response.ok(), payload.error ?? payload.result?.error).toBe(true);
  await expect(button).toBeEnabled({
    timeout: Number(process.env.RUS_019_BUTTON_TIMEOUT_MS ?? 90_000),
  });

  return payload;
}
