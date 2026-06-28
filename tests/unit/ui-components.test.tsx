// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import RootLayout from "@app/layout";
import {
  buildAgentEvents,
  formatAgentToolName,
  getAgentConversationHref,
  getAgentSessionViewState,
} from "@/components/agent/agent-event-list";
import { BottomNav } from "@/components/bottom-nav";
import { getAgentStartResult } from "@/components/home/commute-input";
import { BufferList } from "@/components/trips/buffer-list";
import { RouteTimeline } from "@/components/trips/route-timeline";
import { SettingsForm } from "@app/settings/settings-form";
import {
  formatMonitoredDuration,
  getMonitoringStatusDisplay,
} from "@/lib/trips/monitoring";

describe("sample-aligned UI components", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders BottomNav labels and navigation aria labels", () => {
    const html = renderToStaticMarkup(<BottomNav active="home" />);

    expect(html).toContain("aria-label=\"首页\"");
    expect(html).toContain("aria-label=\"历史\"");
    expect(html).toContain("aria-label=\"设置\"");
    expect(html).toContain("aria-label=\"记忆\"");
    expect(html).toContain("首页");
    expect(html).toContain("历史");
    expect(html).toContain("设置");
    expect(html).toContain("记忆");
  });

  it("renders buffer items with weather as zero-minute context", () => {
    const html = renderToStaticMarkup(
      <BufferList
        buffers={[
          {
            id: "traffic",
            category: "traffic",
            label: "交通缓冲",
            minutes: 8,
            reason: "晚高峰环路拥堵",
          },
          {
            id: "weather",
            category: "weather",
            label: "天气参考",
            minutes: 0,
            reason: "到达前后可能有小雨",
          },
        ]}
      />
    );

    expect(html).toContain("交通缓冲");
    expect(html).toContain("8 分钟");
    expect(html).toContain("天气参考");
    expect(html).toContain("0 分钟");
    expect(html).toContain("到达前后可能有小雨");
  });

  it("renders route timeline segment titles", () => {
    const html = renderToStaticMarkup(
      <RouteTimeline
        segments={[
          {
            id: "walk",
            mode: "walk",
            title: "步行到地铁 4 号线",
            detail: "B 口进站",
            minutes: 5,
          },
          {
            id: "train",
            mode: "transit",
            title: "地铁 4 号线",
            detail: "向北 8 站",
            minutes: 20,
          },
        ]}
      />
    );

    expect(html).toContain("步行到地铁 4 号线");
    expect(html).toContain("地铁 4 号线");
  });

  it("renders grouped route timelines for multi-stop trips", () => {
    const html = renderToStaticMarkup(
      <RouteTimeline
        groups={[
          {
            id: "leg-a",
            title: "家到 A 站",
            subtitle: "08:40 前到达",
            segments: [
              {
                id: "metro-a",
                mode: "transit",
                title: "乘地铁到 A 站",
                detail: "6 站",
                minutes: 18,
              },
            ],
          },
          {
            id: "leg-b",
            title: "A 站到电影院",
            subtitle: "09:15 前到达",
            segments: [
              {
                id: "inside-b",
                mode: "destination",
                title: "在商场内步行",
                detail: "从 2 号门进入后前往 4 层",
                minutes: 7,
              },
            ],
          },
        ]}
        segments={[]}
      />
    );

    expect(html).toContain("家到 A 站");
    expect(html).toContain("A 站到电影院");
    expect(html).toContain("在商场内步行");
  });

  it("orders agent messages and tool calls chronologically", () => {
    const events = buildAgentEvents({
      messages: [
        {
          id: "assistant-late",
          role: "assistant",
          content: "已选择路线",
          createdAt: "2026-06-28T08:03:00.000Z",
        },
      ],
      toolCalls: [
        {
          id: "poi-early",
          name: "search_poi",
          status: "completed",
          createdAt: "2026-06-28T08:01:00.000Z",
        },
      ],
    });

    expect(events.map((event) => event.title)).toEqual([
      "搜索地点",
      "智能体更新",
    ]);
  });

  it("formats agent tool names for display", () => {
    expect(formatAgentToolName("get_weather_reference")).toBe("获取天气参考");
    expect(formatAgentToolName("create_trip")).toBe("创建行程");
    expect(formatAgentToolName("unknown_tool")).toBe("工具调用");
  });

  it("only auto-redirects completed agent sessions when enabled", () => {
    const state = getAgentSessionViewState({
      autoRedirect: true,
      session: { status: "completed", tripId: "trip-1" },
    });

    expect(state.redirectTo).toBe("/trips/trip-1");
    expect(state.redirectDelayMs).toBeGreaterThanOrEqual(750);
    expect(
      getAgentSessionViewState({
        autoRedirect: false,
        session: { status: "completed", tripId: "trip-1" },
      }).redirectTo
    ).toBeNull();
  });

  it("builds conversation links that do not auto-redirect completed sessions", () => {
    expect(getAgentConversationHref("session-1")).toBe(
      "/agent/session-1?view=conversation"
    );
  });

  it("formats monitored duration in Chinese", () => {
    expect(
      formatMonitoredDuration({
        createdAt: new Date("2026-06-28T00:00:00.000Z"),
        now: new Date("2026-06-28T00:45:00.000Z"),
      })
    ).toBe("45分钟");
  });

  it("uses cancelled trip status as the monitoring status display source", () => {
    expect(
      getMonitoringStatusDisplay({
        tripStatus: "cancelled",
        latestRecalculation: {
          status: "skipped",
          summary: "最近一次复算已跳过。",
          trigger: "reminder",
        },
      })
    ).toEqual({
      title: "监控已取消",
      description: "系统已停止监控该行程，并取消后续提醒。",
      recalculationStatus: "skipped",
      recalculationSummary: "最近一次复算已跳过。",
      trigger: "reminder",
    });
  });

  it("marks failed agent sessions as terminal instead of loading", () => {
    const state = getAgentSessionViewState({
      autoRedirect: true,
      session: { status: "failed", tripId: null },
    });

    expect(state.isTerminal).toBe(true);
    expect(state.isLoading).toBe(false);
  });

  it("routes unauthenticated agent starts to login", () => {
    expect(getAgentStartResult(401, {})).toEqual({
      route: "/login",
      error: "",
    });
  });

  it("loads Inter from the root layout", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <main>App</main>
      </RootLayout>
    );

    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("family=Inter");
  });

  it("renders a default origin selector without a visible coordinate input", () => {
    const html = renderToStaticMarkup(
      <SettingsForm
        values={{
          defaultCity: "宁波",
          timezone: "Asia/Shanghai",
          originName: "",
          originLngLat: "",
          routePreference: "balanced",
          telegramChatId: "",
          emailRecipient: "",
        }}
      />
    );

    expect(html).toContain("默认出发点");
    expect(html).toContain("通勤方式倾向");
    expect(html).toContain("公交地铁优先");
    expect(html).not.toContain("出发点坐标");
    expect(html).toContain('name="originLngLat"');
    expect(html).toContain('type="hidden"');
  });

  it("searches places with the edited default city and submits the selected origin", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = String(url);

      if (requestUrl.startsWith("/api/places/search")) {
        return Response.json({
          places: [
            {
              id: "west-lake",
              name: "西湖",
              address: "杭州市西湖区",
              lngLat: "120.141705,30.259244",
            },
          ],
        });
      }

      if (requestUrl === "/api/settings" && init?.method === "PUT") {
        return Response.json({ settings: {} });
      }

      return Response.json({ error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SettingsForm
        values={{
          defaultCity: "宁波",
          timezone: "Asia/Shanghai",
          originName: "",
          originLngLat: "",
          routePreference: "balanced",
          telegramChatId: "",
          emailRecipient: "",
        }}
      />
    );

    fireEvent.change(screen.getByLabelText("默认城市"), {
      target: { value: "杭州" },
    });
    fireEvent.change(screen.getByLabelText("搜索默认出发点"), {
      target: { value: "西湖" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("city=%E6%9D%AD%E5%B7%9E")
      );
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("city=%E5%AE%81%E6%B3%A2")
    );

    fireEvent.click(await screen.findByRole("button", { name: /西湖/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(([url, init]) => {
        return String(url) === "/api/settings" && init?.method === "PUT";
      });
      expect(putCall).toBeDefined();
      expect(JSON.parse(String(putCall?.[1]?.body))).toEqual(
        expect.objectContaining({
          originName: "西湖",
          originLngLat: "120.141705,30.259244",
        })
      );
    });
  });
});
