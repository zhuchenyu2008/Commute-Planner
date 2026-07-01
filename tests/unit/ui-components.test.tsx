// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import RootLayout from "@app/layout";
import {
  AgentEventList,
  getAgentConversationHref,
  getAgentSendMessageResult,
  getAgentSessionViewState,
} from "@/components/agent/agent-event-list";
import { buildAgentEvents, formatAgentToolName } from "@/lib/agent/events";
import { AppShell } from "@/components/app-shell";
import { BottomNav } from "@/components/bottom-nav";
import { HistoryDateFilter } from "@/components/history/history-date-filter";
import { CommuteInput, getAgentStartResult } from "@/components/home/commute-input";
import { CurrentLocationLabel } from "@/components/home/current-location-label";
import { BufferList } from "@/components/trips/buffer-list";
import { RouteTimeline } from "@/components/trips/route-timeline";
import { LoginForm } from "@app/login/login-form";
import { SettingsForm } from "@app/settings/settings-form";
import {
  formatMonitoredDuration,
  getMonitoringStatusDisplay,
} from "@/lib/trips/monitoring";

const { completeRouteViewTransitionMock, routerPushMock } = vi.hoisted(() => ({
  completeRouteViewTransitionMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

const REDIRECT_DELAY_FOR_TESTS_MS = 1300;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock("@/lib/ui/agent-transition", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/ui/agent-transition")>();

  return {
    ...actual,
    completeRouteViewTransition: completeRouteViewTransitionMock,
  };
});

describe("sample-aligned UI components", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    completeRouteViewTransitionMock.mockReset();
    routerPushMock.mockReset();
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

  it("marks AppShell main content for page enter motion", () => {
    const html = renderToStaticMarkup(
      <AppShell active="home">
        <div>Content</div>
      </AppShell>
    );

    expect(html).toContain("page-enter");
  });

  it("marks active bottom navigation items for smooth state motion", () => {
    const html = renderToStaticMarkup(<BottomNav active="history" />);

    expect(html).toContain("nav-item-motion");
    expect(html).toContain("nav-item-active");
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

  it("sanitizes assistant markdown while preserving user messages and tool details", () => {
    const events = buildAgentEvents({
      messages: [
        {
          id: "assistant-markdown",
          role: "assistant",
          content: "## **Route**\n- Take `Line 1`",
          createdAt: "2026-06-28T08:01:00.000Z",
        },
        {
          id: "user-markdown",
          role: "user",
          content: "## **Keep this**\n- use `raw`",
          createdAt: "2026-06-28T08:02:00.000Z",
        },
      ],
      toolCalls: [
        {
          id: "tool-markdown",
          name: "search_poi",
          status: "completed",
          error: "**Tool** kept `raw`",
          createdAt: "2026-06-28T08:03:00.000Z",
        },
      ],
    });

    expect(events.map((event) => event.detail)).toEqual([
      "Route\nTake Line 1",
      "## **Keep this**\n- use `raw`",
      "**Tool** kept `raw`",
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

  it("uses the visible planning text as the home submit button name", () => {
    render(<CommuteInput />);

    expect(screen.getByRole("button", { name: "规划" })).toBeTruthy();
  });

  it("stores the prompt before routing from home to agent", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { sessionId: "session-1", status: "running" },
        { status: 201 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<CommuteInput />);

    expect(container.querySelector("[data-agent-transition-source]")).toBeTruthy();

    const promptInput = container.querySelector("input");
    const submitButton = container.querySelector('button[type="submit"]');
    expect(promptInput).toBeTruthy();
    expect(submitButton).toBeTruthy();

    fireEvent.change(promptInput!, {
      target: { value: "  Go to the office by 9  " },
    });
    fireEvent.click(submitButton!);

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/agent/session-1");
    });
    expect(
      window.sessionStorage.getItem("commute-planner:agent-prompt")
    ).toBe("Go to the office by 9");
    expect(
      window.sessionStorage.getItem("commute-planner:agent-session")
    ).toBe("session-1");
  });

  it("does not store an agent transition prompt for non-agent routes", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "login required" }, { status: 401 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<CommuteInput />);

    const promptInput = container.querySelector("input");
    const submitButton = container.querySelector('button[type="submit"]');
    expect(promptInput).toBeTruthy();
    expect(submitButton).toBeTruthy();

    fireEvent.change(promptInput!, {
      target: { value: "  Go to the office by 9  " },
    });
    fireEvent.click(submitButton!);

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/login");
    });
    expect(
      window.sessionStorage.getItem("commute-planner:agent-prompt")
    ).toBeNull();
  });

  it("prioritizes login for unauthenticated agent starts with action hrefs", () => {
    expect(
      getAgentStartResult(401, {
        actionHref: "/settings",
        error: "璇峰厛鐧诲綍",
      })
    ).toEqual({
      route: "/login",
      error: "",
    });
  });

  it("accepts continued agent messages when the API starts a run", () => {
    expect(getAgentSendMessageResult(202, { status: "running" })).toEqual({
      accepted: true,
      error: "",
    });
  });

  it("surfaces continued agent message validation errors", () => {
    expect(
      getAgentSendMessageResult(400, {
        error: "请输入要告诉智能体的内容",
      })
    ).toEqual({
      accepted: false,
      error: "请输入要告诉智能体的内容",
    });
  });

  it("routes agent starts to an action href while preserving the error", () => {
    expect(
      getAgentStartResult(400, {
        actionHref: "/settings",
        error: "请先完成设置",
      })
    ).toEqual({
      route: "/settings",
      error: "请先完成设置",
    });
  });

  it("recovers the home agent start form when fetch rejects", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<CommuteInput />);

    const promptInput = container.querySelector("input");
    const submitButton = container.querySelector('button[type="submit"]');
    expect(promptInput).toBeTruthy();
    expect(submitButton).toBeTruthy();

    fireEvent.change(promptInput!, {
      target: { value: "去公司" },
    });
    fireEvent.click(submitButton!);

    await screen.findByText("无法开始规划。");

    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("continues completed conversation sessions without redirecting", async () => {
    const completedSession = {
      id: "session-1",
      tripId: "trip-1",
      status: "completed",
      prompt: "去公司",
      messages: [],
      toolCalls: [],
    };
    const runningSession = {
      ...completedSession,
      status: "running",
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "再帮我看看下雨怎么办",
          createdAt: "2026-06-29T00:00:00.000Z",
        },
      ],
    };
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === "/api/agent-sessions/session-1/messages") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          message: "再帮我看看下雨怎么办",
        });
        return Response.json({ status: "running" }, { status: 202 });
      }

      if (String(url) === "/api/agent-sessions/session-1") {
        return Response.json({
          session: fetchMock.mock.calls.length > 1 ? runningSession : completedSession,
        });
      }

      return Response.json({ error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEventList autoRedirect={false} sessionId="session-1" />);

    const input = await screen.findByLabelText("告诉智能体更多信息");
    fireEvent.change(input, {
      target: { value: " 再帮我看看下雨怎么办 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给智能体" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/agent-sessions/session-1/messages",
        expect.objectContaining({ method: "POST" })
      );
    });
    await screen.findByText("再帮我看看下雨怎么办");
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("renders the initial prompt as a user message bubble on the agent page", async () => {
    const prompt = "Go to the office by 9";
    window.sessionStorage.setItem("commute-planner:agent-prompt", prompt);
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/agent-sessions/session-1") {
        return Response.json({
          session: {
            id: "session-1",
            tripId: null,
            status: "completed",
            prompt,
            messages: [
              {
                id: "message-1",
                role: "user",
                content: prompt,
                createdAt: "2026-06-29T00:00:00.000Z",
              },
            ],
            toolCalls: [],
          },
        });
      }

      return Response.json({ error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <AgentEventList autoRedirect={false} sessionId="session-1" />
    );

    await screen.findByText(prompt);

    expect(container.querySelector("[data-agent-user-message]")).toBeTruthy();
    expect(screen.getByRole("group", { name: "用户请求" })).toBeTruthy();
    expect(
      container.querySelector('[data-agent-transition-message="true"]')
    ).toBeTruthy();
    expect(screen.getAllByText(prompt)).toHaveLength(1);
  });

  it("completes the route view transition after the target user bubble is rendered", async () => {
    const prompt = "Go to the office by 9";
    window.sessionStorage.setItem("commute-planner:agent-prompt", prompt);
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/agent-sessions/session-1") {
        return Response.json({
          session: {
            id: "session-1",
            tripId: null,
            status: "completed",
            prompt,
            messages: [
              {
                id: "message-1",
                role: "user",
                content: prompt,
                createdAt: "2026-06-29T00:00:00.000Z",
              },
            ],
            toolCalls: [],
          },
        });
      }

      return Response.json({ error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEventList autoRedirect={false} sessionId="session-1" />);

    expect(completeRouteViewTransitionMock).not.toHaveBeenCalled();

    await screen.findByRole("group", { name: "用户请求" });

    expect(completeRouteViewTransitionMock).toHaveBeenCalledTimes(1);
  });

  it("marks only the first duplicate user message as the agent transition target", async () => {
    const prompt = "Go to the office by 9";
    window.sessionStorage.setItem("commute-planner:agent-prompt", prompt);
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/agent-sessions/session-1") {
        return Response.json({
          session: {
            id: "session-1",
            tripId: null,
            status: "completed",
            prompt,
            messages: [
              {
                id: "message-1",
                role: "user",
                content: prompt,
                createdAt: "2026-06-29T00:00:00.000Z",
              },
              {
                id: "message-2",
                role: "user",
                content: prompt,
                createdAt: "2026-06-29T00:01:00.000Z",
              },
            ],
            toolCalls: [],
          },
        });
      }

      return Response.json({ error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <AgentEventList autoRedirect={false} sessionId="session-1" />
    );

    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-agent-user-message]")
      ).toHaveLength(2);
    });

    expect(
      container.querySelectorAll('[data-agent-transition-message="true"]')
    ).toHaveLength(1);
  });

  it("redirects completed conversation sessions only after a continued run completes", async () => {
    const completedSession = {
      id: "session-1",
      tripId: "trip-1",
      status: "completed",
      prompt: "去公司",
      messages: [],
      toolCalls: [],
    };
    const runningSession = {
      ...completedSession,
      status: "running",
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "再帮我看看下雨怎么办",
          createdAt: "2026-06-29T00:00:00.000Z",
        },
      ],
    };
    const completedAfterContinuationSession = {
      ...runningSession,
      status: "completed",
      messages: [
        ...runningSession.messages,
        {
          id: "message-2",
          role: "assistant",
          content: "已完成更新",
          createdAt: "2026-06-29T00:01:00.000Z",
        },
      ],
    };
    const getSessions = [
      completedSession,
      runningSession,
      completedAfterContinuationSession,
    ];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === "/api/agent-sessions/session-1/messages") {
        expect(init?.method).toBe("POST");
        return Response.json({ status: "running" }, { status: 202 });
      }

      if (String(url) === "/api/agent-sessions/session-1") {
        return Response.json({
          session: getSessions.shift() ?? completedAfterContinuationSession,
        });
      }

      return Response.json({ error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AgentEventList allowMessages autoRedirect sessionId="session-1" />
    );

    const input = document.querySelector("input");
    expect(input).toBeTruthy();
    await new Promise((resolve) =>
      window.setTimeout(resolve, REDIRECT_DELAY_FOR_TESTS_MS)
    );
    expect(routerPushMock).not.toHaveBeenCalled();

    fireEvent.change(input!, {
      target: { value: "再帮我看看下雨怎么办" },
    });
    fireEvent.click(document.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
    await screen.findByText("agent已完成规划");

    await new Promise((resolve) =>
      window.setTimeout(resolve, REDIRECT_DELAY_FOR_TESTS_MS)
    );

    expect(routerPushMock).toHaveBeenCalledWith("/trips/trip-1");
  }, 10000);

  it("does not post continued messages while the session is running", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === "/api/agent-sessions/session-running") {
        return Response.json({
          session: {
            id: "session-running",
            tripId: null,
            status: "running",
            prompt: "去公司",
            messages: [],
            toolCalls: [],
          },
        });
      }

      return Response.json({ error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEventList autoRedirect={false} sessionId="session-running" />);

    const input = await screen.findByLabelText("告诉智能体更多信息");
    expect((input as HTMLInputElement).disabled).toBe(true);
    fireEvent.submit(input.closest("form")!);

    expect(
      fetchMock.mock.calls.some(([url, init]) => {
        return (
          String(url) === "/api/agent-sessions/session-running/messages" &&
          init?.method === "POST"
        );
      })
    ).toBe(false);
  });

  it("shows an error when loading an agent session rejects", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEventList autoRedirect={false} sessionId="session-error" />);

    await screen.findByText("无法加载智能体会话。");
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

  it("renders login and settings form controls with visible field frames", () => {
    const loginView = render(<LoginForm />);

    expect(loginView.container.querySelector("#email")?.getAttribute("class")).toContain(
      "form-field-frame"
    );
    expect(
      loginView.container.querySelector("#password")?.getAttribute("class")
    ).toContain("form-field-frame");

    cleanup();

    const settingsView = render(
      <SettingsForm
        values={{
          defaultCity: "Ningbo",
          timezone: "Asia/Shanghai",
          originName: "",
          originLngLat: "",
          routePreference: "balanced",
          telegramChatId: "",
          emailRecipient: "",
        }}
      />
    );

    for (const selector of [
      "#defaultCity",
      "#timezone",
      'input[type="search"]',
      "#routeChangeThresholdMinutes",
      "#telegramChatId",
      "#emailRecipient",
    ]) {
      expect(
        settingsView.container.querySelector(selector)?.getAttribute("class")
      ).toContain("form-field-frame");
    }
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
    expect(html).toContain("北京时间（Asia/Shanghai）");
    expect(html).toContain("通勤方式倾向");
    expect(html).toContain('name="timezone"');
    expect(html).toContain('name="routePreference"');
    expect(html).toContain('type="hidden"');
    expect(html).not.toContain("<select");
    expect(html).not.toContain("appearance-none");
    expect(html).not.toContain("出发点坐标");
    expect(html).toContain('name="originLngLat"');
    expect(html).toContain('type="hidden"');
  });

  it("opens the custom route preference selector options", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "通勤方式倾向" }));

    expect(screen.getByRole("option", { name: /公交地铁优先/ })).toBeTruthy();
  });

  it("keeps the current location label textual instead of coordinates", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 29.865249,
          longitude: 121.523031,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition);
    });
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition },
    });

    render(<CurrentLocationLabel fallbackCity="宁波外事学校" />);

    expect(await screen.findByText("宁波外事学校")).toBeTruthy();
    expect(screen.queryByText(/29\.8652/)).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("allows the current location label to be styled as the home heading", () => {
    const html = renderToStaticMarkup(
      <CurrentLocationLabel fallbackCity="东钱湖地铁站" className="block" />
    );

    expect(html).toContain("东钱湖地铁站");
    expect(html).toContain("block");
  });

  it("renders a custom history date trigger instead of a native date input", () => {
    const { container } = render(<HistoryDateFilter value="2026-06-30" />);

    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(container.querySelector('input[name="date"]')?.getAttribute("type")).toBe(
      "hidden"
    );

    fireEvent.click(
      screen.getByRole("button", { name: "查看日期 2026年6月30日" })
    );

    expect(screen.getByRole("dialog", { name: "选择历史日期" })).toBeTruthy();
    expect(screen.getByText("2026年6月")).toBeTruthy();
  });

  it("navigates the visible month in the custom history calendar", () => {
    render(<HistoryDateFilter value="2026-06-30" />);

    fireEvent.click(
      screen.getByRole("button", { name: "查看日期 2026年6月30日" })
    );
    fireEvent.click(screen.getByRole("button", { name: "上个月" }));

    expect(screen.getByText("2026年5月")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "下个月" }));

    expect(screen.getByText("2026年6月")).toBeTruthy();
  });

  it("syncs the custom history date trigger when the server value changes", () => {
    const { rerender } = render(<HistoryDateFilter value="2026-06-30" />);

    rerender(<HistoryDateFilter value="2026-06-29" />);

    expect(
      screen.getByRole("button", { name: "查看日期 2026年6月29日" })
    ).toBeTruthy();
  });

  it("submits the history date filter when the user picks a calendar day", () => {
    const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
    const requestSubmit = vi.fn();
    HTMLFormElement.prototype.requestSubmit = requestSubmit;

    try {
      const { container } = render(<HistoryDateFilter value="2026-06-30" />);

      fireEvent.click(
        screen.getByRole("button", { name: "查看日期 2026年6月30日" })
      );
      fireEvent.click(
        screen.getByRole("button", { name: "选择 2026年6月29日" })
      );

      expect(
        (container.querySelector('input[name="date"]') as HTMLInputElement).value
      ).toBe("2026-06-29");
      expect(requestSubmit).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog", { name: "选择历史日期" })).toBeNull();
    } finally {
      HTMLFormElement.prototype.requestSubmit = originalRequestSubmit;
    }
  });

  it("sends Telegram and email test notifications from settings", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (
        String(url) === "/api/settings/test-notification" &&
        init?.method === "POST"
      ) {
        return Response.json({
          result: {
            status: "sent",
            recipient: JSON.parse(String(init.body)).telegramChatId ?? JSON.parse(String(init.body)).emailRecipient,
          },
        });
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
          telegramChatId: "telegram-chat",
          emailRecipient: "user@example.com",
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "发送测试消息" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings/test-notification",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            channel: "telegram",
            telegramChatId: "telegram-chat",
          }),
        })
      );
    });
    await screen.findByText("Telegram 测试已发送");

    fireEvent.click(screen.getByRole("button", { name: "发送测试邮件" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings/test-notification",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            channel: "email",
            emailRecipient: "user@example.com",
          }),
        })
      );
    });
    await screen.findByText("邮件测试已发送");
  });

  it("shows detailed test notification failures in settings", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        result: {
          status: "skipped",
          recipient: "telegram-chat",
          error: "缺少 TELEGRAM_BOT_TOKEN",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SettingsForm
        values={{
          defaultCity: "宁波",
          timezone: "Asia/Shanghai",
          originName: "",
          originLngLat: "",
          routePreference: "balanced",
          telegramChatId: "telegram-chat",
          emailRecipient: "",
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "发送测试消息" }));

    await screen.findByText("Telegram 测试未发送：缺少 TELEGRAM_BOT_TOKEN");
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
