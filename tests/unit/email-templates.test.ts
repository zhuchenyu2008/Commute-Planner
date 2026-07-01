import { describe, expect, it } from "vitest";
import {
  buildDepartureReminderEmail,
  buildRouteChangeEmail,
} from "@/lib/notifications/email-templates";

const baseInput = {
  appName: "AI Commute",
  tripTitle: "家到科技园",
  destinationName: "科技园区A座",
  destinationAddress: "创新大道 123 号",
  latestDepartAt: new Date("2026-07-01T00:35:00.000Z"),
  targetArriveAt: new Date("2026-07-01T01:15:00.000Z"),
  totalMinutes: 40,
  routeTitle: "地铁 4 号线 -> 共享单车",
  weatherSummary: "以行程详情为准",
  detailsUrl: "https://commute.example.com/trips/trip-1",
  stopMonitoringUrl: "https://commute.example.com/trips/trip-1",
} as const;

describe("email templates", () => {
  it("builds a departure reminder email with sample-aligned content", () => {
    const email = buildDepartureReminderEmail(baseInput);

    expect(email.subject).toBe("通勤提醒：该出发了");
    expect(email.text).toContain("AI Commute");
    expect(email.text).toContain("该出发了");
    expect(email.text).toContain("最晚出发时间：08:35");
    expect(email.text).toContain("预计到达时间");
    expect(email.text).toContain("科技园区A座");
    expect(email.text).toContain("查看实时地图");
    expect(email.text).toContain("https://commute.example.com/trips/trip-1");
    expect(email.html).toContain("AI Commute");
    expect(email.html).toContain("该出发了");
    expect(email.html).toContain("请在");
    expect(email.html).toContain("前出发");
    expect(email.html).toContain("08:35");
    expect(email.html).toContain("预计到达时间");
    expect(email.html).toContain("科技园区A座");
    expect(email.html).toContain("查看实时地图");
    expect(email.html).toContain(
      'href="https://commute.example.com/trips/trip-1"'
    );
  });

  it("builds a route change email that emphasizes the changed departure time", () => {
    const email = buildRouteChangeEmail({
      ...baseInput,
      changeMinutes: 5,
      previousLatestDepartAt: new Date("2026-07-01T00:30:00.000Z"),
    });

    expect(email.subject).toBe("通勤时间已变化：家到科技园");
    expect(email.text).toContain("AI Commute");
    expect(email.text).not.toContain("Lumina Velocity");
    expect(email.text).toContain("出发时间已更新");
    expect(email.text).toContain("变化约 5 分钟");
    expect(email.text).toContain("受路况影响，出发时间变化约 5 分钟");
    expect(email.text).toContain("原最晚出发时间：08:30");
    expect(email.text).toContain("最晚出发时间：08:35");
    expect(email.html).toContain("出发时间已更新");
    expect(email.html).toContain("受路况影响，出发时间变化约 5 分钟");
    expect(email.html).toContain("原最晚出发时间：");
    expect(email.html).toContain("08:30");
    expect(email.html).toContain("08:35");
    expect(email.html).toContain("AI Commute");
    expect(email.html).not.toContain("Lumina Velocity");
  });

  it("escapes user-controlled text in html while keeping readable plain text", () => {
    const email = buildDepartureReminderEmail({
      ...baseInput,
      destinationName: "<script>alert(1)</script>",
      routeTitle: "地铁 <4> 号线",
    });

    expect(email.text).toContain("<script>alert(1)</script>");
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).toContain("地铁 &lt;4&gt; 号线");
  });

  it("hides map and stop links when email urls are placeholders or unsafe", () => {
    const dangerousEmail = buildDepartureReminderEmail({
      ...baseInput,
      detailsUrl: "javascript:alert(1)",
      stopMonitoringUrl: "data:text/html,<b>x</b>",
    });
    const protocolRelativeEmail = buildDepartureReminderEmail({
      ...baseInput,
      detailsUrl: "//evil.example/trips/1",
      stopMonitoringUrl: "trips/1",
    });
    const relativeEmail = buildDepartureReminderEmail({
      ...baseInput,
      detailsUrl: "/trips/1",
      stopMonitoringUrl: "#",
    });

    expect(dangerousEmail.html).not.toContain("javascript:alert(1)");
    expect(dangerousEmail.html).not.toContain("data:text/html");
    expect(dangerousEmail.html).not.toContain("查看实时地图");
    expect(dangerousEmail.text).not.toContain("查看实时地图：");
    expect(dangerousEmail.html).not.toContain("停止监控此行程</a>");
    expect(protocolRelativeEmail.html).not.toContain("//evil.example/trips/1");
    expect(protocolRelativeEmail.html).not.toContain('href="trips/1"');
    expect(protocolRelativeEmail.html).not.toContain("查看实时地图");
    expect(relativeEmail.html).not.toContain('href="/trips/1"');
    expect(relativeEmail.html).not.toContain('href="#"');
    expect(relativeEmail.html).not.toContain("查看实时地图");
  });

  it("keeps map and stop links only for absolute http urls", () => {
    const allowedEmail = buildDepartureReminderEmail({
      ...baseInput,
      detailsUrl: " https://example.com/trips/1 ",
      stopMonitoringUrl: "http://example.com/trips/1",
    });

    expect(allowedEmail.html).toContain('href="https://example.com/trips/1"');
    expect(allowedEmail.html).toContain('href="http://example.com/trips/1"');
    expect(allowedEmail.text).toContain(
      "查看实时地图：https://example.com/trips/1"
    );
    expect(allowedEmail.text).toContain(
      "停止监控：http://example.com/trips/1"
    );
  });
});
