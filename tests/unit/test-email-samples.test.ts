import { describe, expect, it, vi } from "vitest";
import {
  buildTemplateEmailRecipientQuery,
  selectTemplateEmailRecipient,
} from "@/lib/notifications/test-email-recipient";
import { buildTemplateTestEmails } from "@/lib/notifications/test-email-samples";
import { sendTemplateTestEmails } from "@/lib/notifications/test-email-sender";

describe("template test emails", () => {
  it("builds one departure email and one route-change email", () => {
    const emails = buildTemplateTestEmails({
      now: new Date("2026-07-01T00:00:00.000Z"),
    });

    expect(emails).toHaveLength(2);
    expect(emails[0]).toMatchObject({
      label: "到点提醒",
      subject: "通勤提醒：该出发了",
    });
    expect(emails[0].html).toContain("该出发了");
    expect(emails[1]).toMatchObject({
      label: "时间更新",
      subject: "通勤时间已变化：测试通勤路线",
    });
    expect(emails[1].html).toContain("出发时间已更新");
  });
});

describe("template test email recipient selection", () => {
  it("skips blank latest recipients and selects the next usable address", () => {
    const recipient = selectTemplateEmailRecipient([
      { emailRecipient: "   " },
      { emailRecipient: "  commuter@example.com  " },
    ]);

    expect(recipient).toBe("commuter@example.com");
  });

  it("returns null when every candidate is null or blank", () => {
    const recipient = selectTemplateEmailRecipient([
      { emailRecipient: null },
      { emailRecipient: "" },
      { emailRecipient: "   " },
    ]);

    expect(recipient).toBeNull();
  });

  it("can select a usable recipient after the first 10 candidates", () => {
    const recipient = selectTemplateEmailRecipient([
      ...Array.from({ length: 10 }, () => ({ emailRecipient: "   " })),
      { emailRecipient: "  later@example.com  " },
    ]);

    expect(recipient).toBe("later@example.com");
  });

  it("does not limit recipient lookup to the latest 10 settings", () => {
    expect(buildTemplateEmailRecipientQuery()).not.toHaveProperty("take");
  });
});

describe("template test email sending", () => {
  it("attempts both emails before failing when the first result is not sent", async () => {
    const emails = [
      {
        label: "到点提醒" as const,
        subject: "first",
        text: "first text",
        html: "<p>first</p>",
      },
      {
        label: "时间更新" as const,
        subject: "second",
        text: "second text",
        html: "<p>second</p>",
      },
    ];
    const sendEmail = vi
      .fn()
      .mockResolvedValueOnce({
        status: "failed",
        recipient: "commuter@example.com",
        error: "smtp unavailable",
      })
      .mockResolvedValueOnce({
        status: "sent",
        recipient: "commuter@example.com",
      });
    const log = vi.fn();

    await expect(
      sendTemplateTestEmails({
        recipient: "commuter@example.com",
        emails,
        sendEmail,
        log,
      })
    ).rejects.toThrow("到点提醒测试邮件未发送成功：smtp unavailable");

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(2);
  });
});
