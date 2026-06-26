import { test, expect } from "@playwright/test";

test("login, plan a trip, and view trip detail", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !text.includes("ERR_NETWORK_ACCESS_DENIED")) {
      errors.push(text);
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/login");
  await page.getByPlaceholder("请输入密码").fill("change-me-now");
  await Promise.all([page.waitForURL("**/"), page.getByRole("button", { name: /进入/ }).click()]);
  await expect(page.getByPlaceholder("你想去哪儿？")).toBeVisible();

  await page.getByPlaceholder("你想去哪儿？").fill("明天 9:15 到龙湖天街");
  await page.getByPlaceholder("你想去哪儿？").press("Enter");
  await expect(page.getByText("行程拆解")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("提醒计划")).toBeVisible();

  expect(errors).toEqual([]);
});
