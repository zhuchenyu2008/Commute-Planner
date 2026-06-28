import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

describe("settings persistence", () => {
  it("stores commute defaults needed by the planner", async () => {
    const user = await prisma.user.create({
      data: {
        email: `settings-${Date.now()}@example.com`,
        name: "Settings User",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "宁波",
            timezone: "Asia/Shanghai",
            originName: "家",
            originLngLat: "121.5230315924,29.8652491273",
            routePreference: "balanced",
            telegramChatId: "telegram:-100",
            emailRecipient: "user@example.com"
          }
        }
      },
      include: { settings: true }
    });

    expect(user.settings?.defaultCity).toBe("宁波");
    expect(user.settings?.timezone).toBe("Asia/Shanghai");
    expect(user.settings?.originLngLat).toContain(",");
  });
});
