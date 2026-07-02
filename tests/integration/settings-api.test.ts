import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createUserSession, getCurrentUser } from "@/lib/auth/session";
import { ensureTestDatabase } from "./test-db";

type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;

const getCurrentUserMock = vi.hoisted(() => vi.fn<() => Promise<CurrentUser | null>>());
const searchPoiMock = vi.hoisted(() => vi.fn());
const createAmapClientMock = vi.hoisted(() => vi.fn());
const sendTelegramMock = vi.hoisted(() => vi.fn());
const sendEmailMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    getCurrentUser: getCurrentUserMock
  };
});

vi.mock("@/lib/amap", () => ({
  createAmapClient: createAmapClientMock
}));

vi.mock("@/lib/notifications/telegram", () => ({
  sendTelegram: sendTelegramMock,
}));

vi.mock("@/lib/notifications/email", () => ({
  sendEmail: sendEmailMock,
}));

describe("settings API", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  beforeEach(() => {
    getCurrentUserMock.mockReset();
    searchPoiMock.mockReset();
    createAmapClientMock.mockReset();
    sendTelegramMock.mockReset();
    sendEmailMock.mockReset();
    searchPoiMock.mockResolvedValue([
      {
        id: "poi-westlake",
        name: "西湖",
        address: "杭州",
        lngLat: "120.1,30.2"
      }
    ]);
    createAmapClientMock.mockReturnValue({ searchPoi: searchPoiMock });
    sendTelegramMock.mockResolvedValue({
      status: "sent",
      recipient: "telegram-chat",
    });
    sendEmailMock.mockResolvedValue({
      status: "sent",
      recipient: "user@example.com",
    });
  });

  it("rejects unauthenticated settings requests", async () => {
    const { GET } = await import("@app/api/settings/route");
    getCurrentUserMock.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns default settings for authenticated users without saved settings", async () => {
    const { GET } = await import("@app/api/settings/route");
    const user = await prisma.user.create({
      data: {
        email: `settings-default-${Date.now()}@example.com`,
        name: "默认设置用户",
        passwordHash: "hash"
      },
      include: { settings: true }
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.defaultCity).toBe("宁波");
    expect(body.settings.originLngLat).toBe("");
    expect(body.settings.routePreference).toBe("balanced");
    expect(body.settings.routeChangeThresholdMinutes).toBe(3);
  });

  it("returns blank origin fields when the user has not selected a default origin", async () => {
    const { GET } = await import("@app/api/settings/route");
    const user = await prisma.user.create({
      data: {
        email: `settings-no-origin-${Date.now()}@example.com`,
        name: "No Origin User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.originName).toBe("");
    expect(body.settings.originLngLat).toBe("");
  });

  it("searches origin candidates for authenticated users", async () => {
    const { GET } = await import("@app/api/places/search/route");
    const user = await prisma.user.create({
      data: {
        email: `place-search-${Date.now()}@example.com`,
        name: "Place Search User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await GET(
      new Request("http://localhost/api/places/search?keywords=外事学校&city=宁波")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(searchPoiMock).toHaveBeenCalledWith({
      keywords: "外事学校",
      city: "宁波"
    });
    expect(body.places).toEqual([
      {
        id: "poi-westlake",
        name: "西湖",
        address: "杭州",
        lngLat: "120.1,30.2"
      }
    ]);
  });

  it("rejects empty place search keywords before calling AMap", async () => {
    const { GET } = await import("@app/api/places/search/route");
    const user = await prisma.user.create({
      data: {
        email: `place-search-empty-${Date.now()}@example.com`,
        name: "Empty Place Search User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await GET(
      new Request("http://localhost/api/places/search?keywords=%20%20&city=宁波")
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("请输入地点关键词");
    expect(createAmapClientMock).not.toHaveBeenCalled();
  });

  it("returns a stable JSON error when AMap place search fails", async () => {
    const { GET } = await import("@app/api/places/search/route");
    const user = await prisma.user.create({
      data: {
        email: `place-search-failure-${Date.now()}@example.com`,
        name: "Place Search Failure User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);
    searchPoiMock.mockRejectedValue(new Error("AMap network down"));

    const response = await GET(
      new Request("http://localhost/api/places/search?keywords=外事学校&city=宁波")
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toContain("地点搜索失败");
    expect(body.error).toContain("AMap network down");
  });

  it("rejects unauthenticated place searches", async () => {
    const { GET } = await import("@app/api/places/search/route");
    getCurrentUserMock.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/places/search?keywords=外事学校&city=宁波")
    );

    expect(response.status).toBe(401);
    expect(createAmapClientMock).not.toHaveBeenCalled();
  });

  it("persists valid settings updates", async () => {
    const { PUT } = await import("@app/api/settings/route");
    const user = await prisma.user.create({
      data: {
        email: `settings-put-${Date.now()}@example.com`,
        name: "设置更新用户",
        passwordHash: "hash"
      },
      include: { settings: true }
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          defaultCity: "宁波",
          timezone: "Asia/Shanghai",
          originName: "家",
          originLngLat: "121.5230315924,29.8652491273",
          routePreference: "fastest",
          emailRecipient: "user@example.com",
          routeChangeThresholdMinutes: 6
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.routePreference).toBe("fastest");
    expect(body.settings.emailRecipient).toBe("user@example.com");
    expect(body.settings.routeChangeThresholdMinutes).toBe(6);
  });

  it("rejects saving a Telegram Chat ID that is already bound to another user", async () => {
    const { PUT } = await import("@app/api/settings/route");
    const duplicateChatId = `chat-dup-${Date.now()}-${Math.random()}`;
    const firstUser = await prisma.user.create({
      data: {
        email: `settings-telegram-first-${Date.now()}@example.com`,
        name: "Telegram First User",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "宁波",
            timezone: "Asia/Shanghai",
            originName: null,
            originLngLat: null,
            routePreference: "balanced",
            telegramChatId: duplicateChatId,
          },
        },
      },
      include: { settings: true },
    });
    const secondUser = await prisma.user.create({
      data: {
        email: `settings-telegram-second-${Date.now()}@example.com`,
        name: "Telegram Second User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(secondUser);

    const response = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          defaultCity: "宁波",
          timezone: "Asia/Shanghai",
          routePreference: "balanced",
          telegramChatId: duplicateChatId,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Telegram Chat ID 已被其他用户绑定"),
      ])
    );
    await expect(
      prisma.userSettings.findUniqueOrThrow({ where: { userId: firstUser.id } })
    ).resolves.toMatchObject({ telegramChatId: duplicateChatId });
    await expect(
      prisma.userSettings.findUnique({ where: { userId: secondUser.id } })
    ).resolves.toBeNull();
  });

  it("returns 400 for invalid planner settings", async () => {
    const { PUT } = await import("@app/api/settings/route");
    const user = await prisma.user.create({
      data: {
        email: `settings-invalid-${Date.now()}@example.com`,
        name: "无效设置用户",
        passwordHash: "hash"
      },
      include: { settings: true }
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          timezone: "Mars/Base",
          originLngLat: "not-coordinates",
          routePreference: "teleport",
          emailRecipient: "not-email",
          routeChangeThresholdMinutes: -1
        })
      })
    );

    expect(response.status).toBe(400);
  });

  it.each([
    ["empty default city", { defaultCity: "" }, "默认城市不能为空"],
    ["unsupported timezone", { timezone: "Mars/Base" }, "不支持该时区"],
    ["unsupported route preference", { routePreference: "teleport" }, "不支持该通勤方式倾向"],
    ["origin name without lngLat", { originName: "家", originLngLat: "" }, "默认出发点必须从候选地点中选择"],
    ["lngLat without origin name", { originName: "", originLngLat: "121.1,29.1" }, "默认出发点必须从候选地点中选择"],
    ["invalid lngLat format", { originName: "家", originLngLat: "abc" }, "默认出发点坐标无效"],
    ["longitude outside range", { originName: "家", originLngLat: "181,29.1" }, "默认出发点坐标无效"],
    ["latitude outside range", { originName: "家", originLngLat: "121.1,91" }, "默认出发点坐标无效"],
    ["invalid email", { emailRecipient: "not-email" }, "邮件接收人格式无效"],
    ["zero threshold", { routeChangeThresholdMinutes: 0 }, "路线变化提醒阈值必须是 1 到 120 分钟之间的整数"],
    ["too large threshold", { routeChangeThresholdMinutes: 121 }, "路线变化提醒阈值必须是 1 到 120 分钟之间的整数"],
    ["decimal threshold", { routeChangeThresholdMinutes: 1.5 }, "路线变化提醒阈值必须是 1 到 120 分钟之间的整数"],
    ["non-numeric string threshold", { routeChangeThresholdMinutes: "later" }, "路线变化提醒阈值必须是 1 到 120 分钟之间的整数"],
    ["blank threshold", { routeChangeThresholdMinutes: "" }, "路线变化提醒阈值必须是 1 到 120 分钟之间的整数"],
  ])("RUS-017 rejects %s with details and preserves existing settings", async (_name, patch, expectedDetail) => {
    const { PUT } = await import("@app/api/settings/route");
    const user = await prisma.user.create({
      data: {
        email: `settings-rus-017-${_name.replace(/\W+/g, "-")}-${Date.now()}@example.com`,
        name: "RUS-017 User",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "宁波",
            timezone: "Asia/Shanghai",
            originName: "家",
            originLngLat: "121.5230315924,29.8652491273",
            routePreference: "balanced",
            emailRecipient: "valid@example.com",
            routeChangeThresholdMinutes: 3,
          },
        },
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          defaultCity: "宁波",
          timezone: "Asia/Shanghai",
          originName: "家",
          originLngLat: "121.5230315924,29.8652491273",
          routePreference: "balanced",
          emailRecipient: "valid@example.com",
          routeChangeThresholdMinutes: 3,
          ...patch,
        }),
      })
    );
    const body = await response.json();
    const stored = await prisma.userSettings.findUniqueOrThrow({
      where: { userId: user.id },
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "设置无效",
      details: expect.arrayContaining([expectedDetail]),
    });
    expect(stored).toMatchObject({
      defaultCity: "宁波",
      timezone: "Asia/Shanghai",
      originName: "家",
      originLngLat: "121.5230315924,29.8652491273",
      routePreference: "balanced",
      emailRecipient: "valid@example.com",
      routeChangeThresholdMinutes: 3,
    });
  });

  it("allows saving planner settings without an origin and requires origin name and coordinates as a pair", async () => {
    const { PUT } = await import("@app/api/settings/route");
    const user = await prisma.user.create({
      data: {
        email: `settings-origin-pair-${Date.now()}@example.com`,
        name: "Origin Pair User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const withoutOrigin = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          defaultCity: "宁波",
          timezone: "Asia/Shanghai",
          routePreference: "balanced",
        }),
      })
    );
    const saved = await withoutOrigin.json();

    expect(withoutOrigin.status).toBe(200);
    expect(saved.settings.originName).toBeNull();
    expect(saved.settings.originLngLat).toBeNull();

    const missingCoordinates = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          defaultCity: "宁波",
          timezone: "Asia/Shanghai",
          originName: "外事学校",
          routePreference: "balanced",
        }),
      })
    );

    expect(missingCoordinates.status).toBe(400);
  });

  it.each([
    ["defaultCity", ""],
    ["timezone", ""],
    ["routePreference", ""],
    ["routeChangeThresholdMinutes", 0],
    ["routeChangeThresholdMinutes", 121],
    ["routeChangeThresholdMinutes", "not-a-number"],
    ["timezone", 123],
    ["routePreference", {}]
  ])("returns 400 when %s is supplied as an invalid value", async (field, value) => {
    const { PUT } = await import("@app/api/settings/route");
    const user = await prisma.user.create({
      data: {
        email: `settings-invalid-supplied-${field}-${Date.now()}@example.com`,
        name: "无效字段用户",
        passwordHash: "hash"
      },
      include: { settings: true }
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({ [field]: value })
      })
    );

    expect(response.status).toBe(400);
  });

  it("rejects unauthenticated test notification requests", async () => {
    const { POST } = await import("@app/api/settings/test-notification/route");
    getCurrentUserMock.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/settings/test-notification", {
        method: "POST",
        body: JSON.stringify({
          channel: "telegram",
          telegramChatId: "telegram-chat",
        }),
      })
    );

    expect(response.status).toBe(401);
    expect(sendTelegramMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it.each([
    ["telegram", { channel: "telegram" }, "Telegram Chat ID 不能为空"],
    ["email", { channel: "email" }, "邮件接收人不能为空"],
  ])("validates %s test notification recipients", async (_channel, body, message) => {
    const { POST } = await import("@app/api/settings/test-notification/route");
    const user = await prisma.user.create({
      data: {
        email: `settings-test-notification-invalid-${_channel}-${Date.now()}@example.com`,
        name: "通知测试用户",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await POST(
      new Request("http://localhost/api/settings/test-notification", {
        method: "POST",
        body: JSON.stringify(body),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe(message);
    expect(sendTelegramMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("sends Telegram test notifications to the supplied chat id", async () => {
    const { POST } = await import("@app/api/settings/test-notification/route");
    const user = await prisma.user.create({
      data: {
        email: `settings-test-telegram-${Date.now()}@example.com`,
        name: "Telegram Test User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await POST(
      new Request("http://localhost/api/settings/test-notification", {
        method: "POST",
        body: JSON.stringify({
          channel: "telegram",
          telegramChatId: "telegram-chat",
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result).toEqual({
      status: "sent",
      recipient: "telegram-chat",
    });
    expect(sendTelegramMock).toHaveBeenCalledWith({
      chatId: "telegram-chat",
      text: expect.stringContaining("AI Commute 测试消息"),
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("returns detailed skipped reasons for test notifications", async () => {
    const { POST } = await import("@app/api/settings/test-notification/route");
    const user = await prisma.user.create({
      data: {
        email: `settings-test-skipped-${Date.now()}@example.com`,
        name: "Skipped Notification User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);
    sendTelegramMock.mockResolvedValue({
      status: "skipped",
      recipient: "telegram-chat",
      error: "缺少 TELEGRAM_BOT_TOKEN",
    });

    const response = await POST(
      new Request("http://localhost/api/settings/test-notification", {
        method: "POST",
        body: JSON.stringify({
          channel: "telegram",
          telegramChatId: "telegram-chat",
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result).toEqual({
      status: "skipped",
      recipient: "telegram-chat",
      error: "缺少 TELEGRAM_BOT_TOKEN",
    });
  });

  it("returns detailed failed reasons for Telegram test notifications without retrying other channels", async () => {
    const { POST } = await import("@app/api/settings/test-notification/route");
    const user = await prisma.user.create({
      data: {
        email: `settings-test-telegram-failed-${Date.now()}@example.com`,
        name: "Failed Telegram Notification User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);
    sendTelegramMock.mockResolvedValue({
      status: "failed",
      recipient: "telegram-chat",
      error: "Telegram 400: Bad Request",
    });

    const response = await POST(
      new Request("http://localhost/api/settings/test-notification", {
        method: "POST",
        body: JSON.stringify({
          channel: "telegram",
          telegramChatId: "telegram-chat",
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result).toMatchObject({
      status: "failed",
      recipient: "telegram-chat",
      error: "Telegram 400: Bad Request",
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("validates invalid email test recipients before SMTP is touched", async () => {
    const { POST } = await import("@app/api/settings/test-notification/route");
    const user = await prisma.user.create({
      data: {
        email: `settings-test-email-invalid-${Date.now()}@example.com`,
        name: "Invalid Email Notification User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await POST(
      new Request("http://localhost/api/settings/test-notification", {
        method: "POST",
        body: JSON.stringify({
          channel: "email",
          emailRecipient: "not-email",
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("邮件接收人格式无效");
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(sendTelegramMock).not.toHaveBeenCalled();
  });

  it("returns detailed skipped reasons for email test notifications without SMTP config", async () => {
    const { POST } = await import("@app/api/settings/test-notification/route");
    const user = await prisma.user.create({
      data: {
        email: `settings-test-email-skipped-${Date.now()}@example.com`,
        name: "Skipped Email Notification User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);
    sendEmailMock.mockResolvedValue({
      status: "skipped",
      recipient: "user@example.com",
      error: "缺少 SMTP_HOST",
    });

    const response = await POST(
      new Request("http://localhost/api/settings/test-notification", {
        method: "POST",
        body: JSON.stringify({
          channel: "email",
          emailRecipient: "user@example.com",
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result).toMatchObject({
      status: "skipped",
      recipient: "user@example.com",
      error: "缺少 SMTP_HOST",
    });
    expect(sendTelegramMock).not.toHaveBeenCalled();
  });

  it("sends email test notifications to the supplied recipient", async () => {
    const { POST } = await import("@app/api/settings/test-notification/route");
    const user = await prisma.user.create({
      data: {
        email: `settings-test-email-${Date.now()}@example.com`,
        name: "Email Test User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await POST(
      new Request("http://localhost/api/settings/test-notification", {
        method: "POST",
        body: JSON.stringify({
          channel: "email",
          emailRecipient: "user@example.com",
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result).toEqual({
      status: "sent",
      recipient: "user@example.com",
    });
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: "user@example.com",
      subject: "AI Commute 测试邮件",
      text: expect.stringContaining("AI Commute 测试邮件"),
    });
    expect(sendTelegramMock).not.toHaveBeenCalled();
  });
});

describe("logout API", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  it("clears malformed session cookies without throwing", async () => {
    const { POST } = await import("@app/api/auth/logout/route");

    const response = await POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: "commute_session=%E0%A4%A" }
      })
    );

    expect(response.status).toBe(200);
  });

  it("deletes a valid session token on logout", async () => {
    const { POST } = await import("@app/api/auth/logout/route");
    const user = await prisma.user.create({
      data: {
        email: `logout-${Date.now()}@example.com`,
        name: "退出登录用户",
        passwordHash: "hash"
      }
    });
    const session = await createUserSession(user.id);

    const response = await POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: `commute_session=${encodeURIComponent(session.token)}` }
      })
    );
    const remaining = await prisma.session.count({ where: { userId: user.id } });

    expect(response.status).toBe(200);
    expect(remaining).toBe(0);
  });
});

