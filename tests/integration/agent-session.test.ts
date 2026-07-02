import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import {
  acceptAgentSessionMessage,
  continueAgentSession,
  runAcceptedContinuationSession,
  runPlanningSession,
  startPlanningSession,
} from "@/lib/agent/planner";
import type {
  AgentChatClient,
  AgentChatMessage,
} from "@/lib/agent/chat-client";
import { createMockAmapClient } from "@/lib/amap/mock";
import { createPlannedTrip } from "@/lib/trips/create-trip";
import { ensureTestDatabase } from "./test-db";

type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;
const getCurrentUserMock = vi.hoisted(() =>
  vi.fn<() => Promise<CurrentUser | null>>()
);

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, getCurrentUser: getCurrentUserMock };
});

describe("agent planning sessions", () => {
  const amapClient = createMockAmapClient();

  beforeAll(async () => {
    await ensureTestDatabase();
  });

  beforeEach(() => {
    getCurrentUserMock.mockReset();
  });

  it("rejects starting a planning session until the user selects a default origin", async () => {
    const { POST } = await import("@app/api/agent-sessions/route");
    const user = await prisma.user.create({
      data: {
        email: `agent-origin-guard-${Date.now()}@example.com`,
        name: "Origin Guard User",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "Ningbo",
            timezone: "Asia/Shanghai",
            originName: null,
            originLngLat: null,
            routePreference: "balanced",
          },
        },
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await POST(
      new Request("http://localhost/api/agent-sessions", {
        method: "POST",
        body: JSON.stringify({ prompt: "Plan my commute tomorrow morning." }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/默认出发点|设置/);
    expect(payload.actionHref).toBe("/settings");
    await expect(
      prisma.agentSession.count({ where: { userId: user.id } })
    ).resolves.toBe(0);
  });

  it("starts a visible running session with the initial user message", async () => {
    const user = await prisma.user.create({
      data: {
        email: `agent-start-${Date.now()}@example.com`,
        name: "Agent Starter",
        passwordHash: "hash",
      },
    });

    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Plan a commute to Longhu mall tomorrow morning.",
    });

    const persisted = await prisma.agentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { messages: true },
    });

    expect(persisted).toMatchObject({
      userId: user.id,
      status: "running",
      purpose: "planning",
      prompt: "Plan a commute to Longhu mall tomorrow morning.",
      retryCount: 0,
      timeoutMs: 600000,
      tripId: null,
    });
    expect(persisted.messages).toHaveLength(1);
    expect(persisted.messages[0]).toMatchObject({
      role: "user",
      content: "Plan a commute to Longhu mall tomorrow morning.",
    });
  });

  it("returns continuation metadata from the session detail endpoint", async () => {
    const { GET } = await import("@app/api/agent-sessions/[sessionId]/route");
    const user = await createUserWithSettings("agent-session-detail");
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Plan a commute with session detail.",
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: "completed" },
    });
    const currentUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(currentUser);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ sessionId: session.id }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.session).toMatchObject({
      id: session.id,
      canContinue: true,
      hasTrip: false,
      messageHref: `/api/agent-sessions/${session.id}/messages`,
    });
  });

  it("rejects continuation messages for missing, foreign, or running sessions", async () => {
    const { POST } = await import(
      "@app/api/agent-sessions/[sessionId]/messages/route"
    );
    const user = await createUserWithSettings("agent-message-owner");
    const otherUser = await createUserWithSettings("agent-message-other");
    const foreignSession = await startPlanningSession({
      userId: otherUser.id,
      prompt: "Foreign session.",
    });
    const runningSession = await startPlanningSession({
      userId: user.id,
      prompt: "Already running session.",
    });
    const currentUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(currentUser);

    const missingResponse = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      }),
      { params: Promise.resolve({ sessionId: "missing-session" }) }
    );
    expect(missingResponse.status).toBe(404);

    const foreignResponse = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      }),
      { params: Promise.resolve({ sessionId: foreignSession.id }) }
    );
    expect(foreignResponse.status).toBe(404);

    const beforeMessages = await prisma.agentMessage.count({
      where: { agentSessionId: runningSession.id, role: "user" },
    });
    const runningResponse = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ message: "do not append" }),
      }),
      { params: Promise.resolve({ sessionId: runningSession.id }) }
    );
    expect(runningResponse.status).toBe(409);
    await expect(
      prisma.agentMessage.count({
        where: { agentSessionId: runningSession.id, role: "user" },
      })
    ).resolves.toBe(beforeMessages);
  });

  it("service rejects continuing a running session without appending a user message", async () => {
    const user = await createUserWithSettings("agent-service-running");
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Already running service session.",
    });
    const beforeMessages = await prisma.agentMessage.count({
      where: { agentSessionId: session.id, role: "user" },
    });

    await expect(
      continueAgentSession({
        userId: user.id,
        sessionId: session.id,
        message: "should be rejected",
      })
    ).rejects.toThrow(/running|already/i);
    await expect(
      prisma.agentMessage.count({
        where: { agentSessionId: session.id, role: "user" },
      })
    ).resolves.toBe(beforeMessages);
  });

  it("accepts a continuation message before running and rejects a second accept", async () => {
    const user = await createUserWithSettings("agent-service-accept");
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Accept this session later.",
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: "completed" },
    });

    const accepted = await acceptAgentSessionMessage({
      userId: user.id,
      sessionId: session.id,
      message: "Persist me before background work.",
    });

    expect(accepted).toMatchObject({
      id: session.id,
      status: "running",
    });
    await expect(
      prisma.agentMessage.count({
        where: { agentSessionId: session.id, role: "user" },
      })
    ).resolves.toBe(2);
    await expect(
      acceptAgentSessionMessage({
        userId: user.id,
        sessionId: session.id,
        message: "Do not persist a second message.",
      })
    ).rejects.toThrow(/running|already/i);
    await expect(
      prisma.agentMessage.count({
        where: { agentSessionId: session.id, role: "user" },
      })
    ).resolves.toBe(2);
  });

  it("keeps an accepted message when continuation running fails later", async () => {
    const user = await createUserWithSettings("agent-accepted-failure");
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Accept then fail this session.",
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: "completed" },
    });

    await acceptAgentSessionMessage({
      userId: user.id,
      sessionId: session.id,
      message: "This message should survive the failed run.",
    });
    const result = await runAcceptedContinuationSession(session.id, {
      amapClient,
      chatClient: {
        async complete() {
          throw new Error("forced continuation failure");
        },
      },
    });

    expect(result.status).toBe("failed");
    const persisted = await prisma.agentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    expect(persisted.status).toBe("failed");
    expect(persisted.messages.map((message) => message.content)).toContain(
      "This message should survive the failed run."
    );
    expect(persisted.messages.at(-1)?.content).toContain(
      "forced continuation failure"
    );
  });

  it("returns 202 only after the continuation message is accepted", async () => {
    const { POST } = await import(
      "@app/api/agent-sessions/[sessionId]/messages/route"
    );
    const user = await createUserWithSettings("agent-message-accepted");
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Accept through API.",
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: "completed" },
    });
    const currentUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(currentUser);

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ message: "API accepted message" }),
      }),
      { params: Promise.resolve({ sessionId: session.id }) }
    );

    expect(response.status).toBe(202);
    const persisted = await prisma.agentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    expect(persisted.status).toBe("running");
    expect(persisted.messages.map((message) => message.content)).toContain(
      "API accepted message"
    );
  });

  it("runs a planning session into a completed trip with tool logs and messages", async () => {
    const user = await createUserWithSettings("agent-run");
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Plan a 9:15 commute to the office.",
    });
    const chatClient = createTripChatClient({
      finalStopName: "Office",
      destinationLngLat: "121.2,29.2",
      routeMinutes: 42,
      mode: "transit",
    });

    const result = await runPlanningSession(session.id, {
      amapClient,
      chatClient,
    });

    expect(result.status).toBe("completed");
    expect(result.tripId).toEqual(expect.any(String));

    const persisted = await prisma.agentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        toolCalls: { orderBy: { createdAt: "asc" } },
        trip: {
          include: {
            stops: { orderBy: { order: "asc" } },
            legs: {
              orderBy: { order: "asc" },
              include: {
                bufferComponents: { orderBy: { order: "asc" } },
                routeCandidates: true,
              },
            },
          },
        },
      },
    });

    expect(persisted.status).toBe("completed");
    expect(persisted.tripId).toBe(result.tripId);
    expect(persisted.messages.map((message) => message.role)).toContain(
      "assistant"
    );
    expect(persisted.messages.map((message) => message.content)).toEqual(
      expect.arrayContaining([
        "第 1 次规划尝试：AI 可以持续调用工具，直到创建最终行程。",
        "AI 已创建规划行程。",
      ])
    );
    expect(persisted.messages.map((message) => message.content)).toContain(
      "AI 已请求调用工具。"
    );
    expect(persisted.messages.map((message) => message.content)).not.toContain(
      "AI requested tool calls."
    );
    expect(persisted.toolCalls.map((call) => call.name)).toEqual(
      expect.arrayContaining([
        "search_poi",
        "get_weather_reference",
        "get_transit_route",
        "create_trip",
      ])
    );
    for (const call of persisted.toolCalls) {
      expect(call.status).toBe("completed");
      expect(call.requestJson).toBeTruthy();
      expect(call.responseJson).toBeTruthy();
      expect(call.durationMs).toEqual(expect.any(Number));
    }
    expect(persisted.trip).toMatchObject({
      status: "monitoring",
      agentSessionId: session.id,
      finalStopName: "Office",
    });
    expect(persisted.trip?.stops).toHaveLength(1);
    expect(persisted.trip?.legs).toHaveLength(1);
    expect(persisted.trip?.legs[0].bufferComponents.map((c) => c.category)).toEqual([
      "transfer",
    ]);
  });

  it("injects confirmed memories into every planning run before the AI calls tools", async () => {
    const user = await createUserWithSettings("agent-memory-context", {
      memories: {
        create: {
          kind: "preference",
          label: "Confirmed memory: prefers cycling",
          valueJson: JSON.stringify({ mode: "bicycling" }),
        },
      },
    });
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Plan a commute to the station.",
    });
    const seenMessages: string[] = [];
    const chatClient = createTripChatClient({
      finalStopName: "Station",
      destinationLngLat: "121.3,29.3",
      routeMinutes: 25,
      mode: "transit",
      onComplete({ messages }) {
        seenMessages.push(...messages.map((message) => message.content));
      },
    });

    await runPlanningSession(session.id, { amapClient, chatClient });

    expect(seenMessages.join("\n")).toContain(
      "Confirmed memory: prefers cycling"
    );
  });

  it("instructs the agent to adapt to bad weather and record explicit habits", async () => {
    const user = await createUserWithSettings("agent-weather-memory-prompt");
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "明天大雨，我习惯雨天少走路。",
    });
    let systemText = "";
    const chatClient: AgentChatClient = {
      async complete({ messages }) {
        systemText = messages
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n");
        throw new Error("stop after prompt capture");
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient,
      chatClient,
    });

    expect(result.status).toBe("failed");
    expect(systemText).toContain("恶劣天气");
    expect(systemText).toContain("长距离步行");
    expect(systemText).toContain("create_memory_candidate");
    expect(systemText).toContain("我习惯");
  });

  it("lets the AI choose AMap tools, route mode, and buffer details", async () => {
    const user = await createUserWithSettings("agent-ai-led");
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Compare transit and biking to the cinema.",
    });
    const requestedTools: string[] = [];
    const chatClient: AgentChatClient = {
      async complete({ messages }) {
        const toolResultCount = messages.filter(
          (message) => message.role === "tool"
        ).length;

        if (toolResultCount === 0) {
          requestedTools.push("search_poi", "get_weather_reference");
          return {
            message: {
              role: "assistant",
              content: "Read POI and weather first.",
              toolCalls: [
                {
                  id: "call-poi",
                  name: "search_poi",
                  arguments: { keywords: "cinema", city: "Ningbo" },
                },
                {
                  id: "call-weather",
                  name: "get_weather_reference",
                  arguments: { city: "Ningbo" },
                },
              ],
            },
          };
        }

        if (toolResultCount === 2) {
          requestedTools.push("get_transit_route", "get_bicycling_route");
          return {
            message: {
              role: "assistant",
              content: "Compare transit and bike.",
              toolCalls: [
                {
                  id: "call-transit",
                  name: "get_transit_route",
                  arguments: {
                    origin: "121.1,29.1",
                    destination: "121.4,29.4",
                    city: "Ningbo",
                    cityd: "Ningbo",
                  },
                },
                {
                  id: "call-bike",
                  name: "get_bicycling_route",
                  arguments: {
                    origin: "121.1,29.1",
                    destination: "121.4,29.4",
                    city: "Ningbo",
                    cityd: "Ningbo",
                  },
                },
              ],
            },
          };
        }

        requestedTools.push("create_trip");
        return createTripToolResponse({
          finalStopName: "Cinema",
          destinationLngLat: "121.4,29.4",
          routeMinutes: 24,
          bufferMinutes: 7,
          totalMinutes: 31,
          mode: "bicycling",
          routeTitle: "AI selected bike route",
          bufferComponents: [
            {
              category: "parking",
              label: "Bike parking",
              minutes: 3,
              reason: "Lock the bike.",
            },
            {
              category: "venue",
              label: "Find screen",
              minutes: 4,
              reason: "Walk inside the mall.",
            },
          ],
        });
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient,
      chatClient,
    });

    expect(result.status).toBe("completed");
    expect(requestedTools).toEqual([
      "search_poi",
      "get_weather_reference",
      "get_transit_route",
      "get_bicycling_route",
      "create_trip",
    ]);

    const persisted = await prisma.agentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: {
        toolCalls: { orderBy: { createdAt: "asc" } },
        trip: {
          include: {
            legs: {
              include: {
                bufferComponents: { orderBy: { order: "asc" } },
                selectedCandidate: true,
              },
            },
          },
        },
      },
    });

    expect(persisted.toolCalls.map((call) => call.name)).toEqual([
      "search_poi",
      "get_weather_reference",
      "get_transit_route",
      "get_bicycling_route",
      "create_trip",
    ]);
    expect(persisted.trip?.legs[0].selectedCandidate).toMatchObject({
      mode: "bicycling",
      routeMinutes: 24,
      bufferMinutes: 7,
      totalMinutes: 31,
      title: "AI selected bike route",
    });
    expect(
      persisted.trip?.legs[0].bufferComponents.map((component) => ({
        category: component.category,
        minutes: component.minutes,
      }))
    ).toEqual([
      { category: "parking", minutes: 3 },
      { category: "venue", minutes: 4 },
    ]);
  });

  it("fails route tools clearly when no origin is available", async () => {
    const user = await prisma.user.create({
      data: {
        email: `agent-no-origin-${Date.now()}@example.com`,
        name: "No Origin Planner",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "Ningbo",
            timezone: "Asia/Shanghai",
            originName: "   ",
            originLngLat: "   ",
            routePreference: "balanced",
          },
        },
      },
    });
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Plan a route without origin.",
    });
    const chatClient: AgentChatClient = {
      async complete({ messages }) {
        const toolResultCount = messages.filter(
          (message) => message.role === "tool"
        ).length;

        if (toolResultCount === 0) {
          return {
            message: {
              role: "assistant",
              content: "Query route first.",
              toolCalls: [
                {
                  id: "call-transit-no-origin",
                  name: "get_transit_route",
                  arguments: {
                    origin: "   ",
                    destination: "121.616,29.868",
                    city: "Ningbo",
                    cityd: "Ningbo",
                  },
                },
              ],
            },
          };
        }

        throw new Error("Planner should stop after the route tool fails.");
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient,
      chatClient,
    });

    expect(result.status).toBe("failed");
    expect(result.tripId).toBeNull();

    const persisted = await prisma.agentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: {
        toolCalls: true,
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    const routeCall = persisted.toolCalls.find(
      (toolCall) => toolCall.name === "get_transit_route"
    );

    expect(persisted.status).toBe("failed");
    expect(routeCall).toMatchObject({ status: "failed" });
    expect(routeCall?.error).toMatch(/默认出发点|设置/);
    expect(persisted.messages.at(-1)?.content).toMatch(
      /默认出发点|设置/
    );
  });

  it("continues an existing session with route update tools and memory candidates", async () => {
    const user = await createUserWithSettings("agent-continue", {
      memories: {
        create: {
          kind: "preference",
          label: "Prefers cycling when weather allows",
          valueJson: JSON.stringify({ preferredMode: "bicycling" }),
        },
      },
    });
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Plan tomorrow commute to the office.",
    });
    const planned = await runPlanningSession(session.id, {
      amapClient,
      chatClient: createTripChatClient({
        finalStopName: "Office",
        destinationLngLat: "121.2,29.2",
        routeMinutes: 35,
        mode: "transit",
      }),
    });
    expect(planned.tripId).toEqual(expect.any(String));

    const seenTools: string[][] = [];
    const seenMessages: string[] = [];
    let calls = 0;
    const chatClient: AgentChatClient = {
      async complete({ messages, tools }) {
        calls += 1;
        seenTools.push(tools.map((tool) => tool.name));
        seenMessages.push(...messages.map((message) => message.content));

        if (calls === 1) {
          return {
            message: {
              role: "assistant",
              content: "Update the existing trip and remember the preference.",
              toolCalls: [
                {
                  id: "update-summary",
                  name: "update_trip_summary",
                  arguments: {
                    title: "Home-Gym",
                    finalStopName: "Gym",
                  },
                },
                {
                  id: "memory-candidate",
                  name: "create_memory_candidate",
                  arguments: {
                    kind: "preference",
                    label: "Prefers gym detours after work",
                    valueJson: { afterWorkStop: "Gym" },
                  },
                },
              ],
            },
          };
        }

        return {
          message: {
            role: "assistant",
            content: "The current trip has been updated.",
          },
        };
      },
    };

    const result = await continueAgentSession(
      {
        userId: user.id,
        sessionId: session.id,
        message: "Change the destination to the gym and remember this.",
      },
      { amapClient, chatClient }
    );

    expect(result.status).toBe("completed");
    expect(result.tripId).toBe(planned.tripId);
    expect(seenTools[0]).toEqual(
      expect.arrayContaining([
        "read_current_trip",
        "update_trip_summary",
        "replace_trip_stops",
        "replace_trip_legs",
        "select_route_candidate",
        "replace_reminder_schedule",
        "cancel_trip_monitoring",
        "create_memory_candidate",
        "get_transit_route",
        "create_trip",
      ])
    );
    expect(seenMessages.join("\n")).toContain(
      "Prefers cycling when weather allows"
    );

    const persisted = await prisma.agentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        toolCalls: { orderBy: { createdAt: "asc" } },
        trip: true,
      },
    });

    expect(persisted.status).toBe("completed");
    expect(persisted.messages.map((m) => m.content)).toContain(
      "Change the destination to the gym and remember this."
    );
    expect(persisted.toolCalls.map((call) => call.name)).toEqual(
      expect.arrayContaining(["update_trip_summary", "create_memory_candidate"])
    );
    expect(persisted.trip).toMatchObject({
      title: "Home-Gym",
      finalStopName: "Gym",
    });
    await expect(
      prisma.memoryCandidate.findFirstOrThrow({
        where: {
          userId: user.id,
          label: "Prefers gym detours after work",
          status: "pending",
        },
      })
    ).resolves.toMatchObject({
      kind: "preference",
      valueJson: JSON.stringify({ afterWorkStop: "Gym" }),
    });
  }, 15000);

  it("completes continuation after a route replacement tool succeeds", async () => {
    const user = await createUserWithSettings("agent-route-replace-complete");
    const trip = await createPlannedTrip({
      userId: user.id,
      rawPrompt: "Existing route to Longhu.",
      timezone: "Asia/Shanghai",
      title: "Home-Longhu",
      targetArriveAt: new Date("2026-07-03T01:00:00.000Z"),
      finalStopName: "Longhu",
      stops: [
        {
          order: 1,
          name: "Longhu",
          lngLat: "121.2,29.2",
          targetArriveAt: new Date("2026-07-03T01:00:00.000Z"),
          kind: "destination",
        },
      ],
      legs: [
        {
          order: 1,
          originName: "Home",
          originLngLat: "121.1,29.1",
          destinationName: "Longhu",
          destinationLngLat: "121.2,29.2",
          targetArriveAt: new Date("2026-07-03T01:00:00.000Z"),
          routeMinutes: 30,
          bufferComponents: [
            {
              category: "transfer",
              label: "Transfer",
              minutes: 5,
              reason: "Leave time for transfer.",
            },
          ],
        },
      ],
    });
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Remove the stopover.",
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: "completed", tripId: trip.id },
    });

    let calls = 0;
    const chatClient: AgentChatClient = {
      async complete() {
        calls += 1;

        if (calls > 1) {
          throw new Error("runner should complete after route replacement");
        }

        return {
          message: {
            role: "assistant",
            content: "Replace the route and stop.",
            toolCalls: [
              {
                id: "replace-route",
                name: "replace_trip_legs",
                arguments: {
                  tripId: trip.id,
                  title: "Home-Office",
                  targetArriveAt: "2026-07-03T01:00:00.000Z",
                  finalStopName: "Office",
                  stops: [
                    {
                      order: 1,
                      name: "Office",
                      lngLat: "121.3,29.3",
                      targetArriveAt: "2026-07-03T01:00:00.000Z",
                      kind: "destination",
                    },
                  ],
                  legs: [
                    {
                      order: 1,
                      originName: "Home",
                      originLngLat: "121.1,29.1",
                      destinationName: "Office",
                      destinationLngLat: "121.3,29.3",
                      targetArriveAt: "2026-07-03T01:00:00.000Z",
                      routeMinutes: 20,
                      bufferMinutes: 5,
                      totalMinutes: 25,
                      mode: "transit",
                      routeTitle: "Transit to Office",
                      routeRationale: "Direct route after removing stopover.",
                      segmentTitle: "Home to Office",
                      segmentDetail: "Direct route.",
                      segmentSource: "amap",
                      source: { source: "test-agent" },
                      bufferComponents: [
                        {
                          category: "transfer",
                          label: "Transfer",
                          minutes: 5,
                          reason: "Leave time for transfer.",
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        };
      },
    };

    const result = await continueAgentSession(
      {
        userId: user.id,
        sessionId: session.id,
        message: "Cancel the stopover and go direct.",
      },
      { amapClient, chatClient }
    );

    expect(calls).toBe(1);
    expect(result).toMatchObject({
      status: "completed",
      tripId: trip.id,
    });
    await expect(
      prisma.agentSession.findUniqueOrThrow({ where: { id: session.id } })
    ).resolves.toMatchObject({
      status: "completed",
      tripId: trip.id,
    });
    await expect(
      prisma.trip.findUniqueOrThrow({
        where: { id: trip.id },
        include: {
          legs: true,
          reminderJobs: { where: { status: "scheduled" } },
        },
      })
    ).resolves.toMatchObject({
      finalStopName: "Office",
      legs: [expect.objectContaining({ destinationName: "Office" })],
      reminderJobs: expect.arrayContaining([
        expect.objectContaining({ kind: "depart_now" }),
      ]),
    });
  });

  it("persists an explicit trip id used by continuation route update tools", async () => {
    const user = await createUserWithSettings("agent-explicit-trip");
    const trip = await createPlannedTrip({
      userId: user.id,
      rawPrompt: "Existing trip created outside the agent session.",
      timezone: "Asia/Shanghai",
      title: "Home-Office",
      finalStopName: "Office",
      stops: [
        {
          order: 1,
          name: "Office",
          lngLat: "121.2,29.2",
          kind: "destination",
        },
      ],
      legs: [
        {
          order: 1,
          originName: "Home",
          originLngLat: "121.1,29.1",
          destinationName: "Office",
          destinationLngLat: "121.2,29.2",
          routeMinutes: 30,
          bufferComponents: [
            {
              category: "transfer",
              label: "Transfer",
              minutes: 5,
              reason: "Leave time for transfer.",
            },
          ],
        },
      ],
    });
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Continue against an explicitly selected trip.",
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: "completed" },
    });

    const chatClient: AgentChatClient = {
      async complete({ messages }) {
        const toolResultCount = messages.filter(
          (message) => message.role === "tool"
        ).length;

        if (toolResultCount === 0) {
          return {
            message: {
              role: "assistant",
              content: "Update explicit trip.",
              toolCalls: [
                {
                  id: "explicit-summary",
                  name: "update_trip_summary",
                  arguments: {
                    tripId: trip.id,
                    title: "Home-Library",
                    finalStopName: "Library",
                  },
                },
              ],
            },
          };
        }

        return {
          message: {
            role: "assistant",
            content: "Explicit trip updated.",
          },
        };
      },
    };

    const result = await continueAgentSession(
      {
        userId: user.id,
        sessionId: session.id,
        message: "Use this explicit trip id.",
      },
      { amapClient, chatClient }
    );

    expect(result).toMatchObject({
      status: "completed",
      tripId: trip.id,
    });
    await expect(
      prisma.agentSession.findUniqueOrThrow({ where: { id: session.id } })
    ).resolves.toMatchObject({
      tripId: trip.id,
      status: "completed",
    });
    await expect(
      prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })
    ).resolves.toMatchObject({
      title: "Home-Library",
      finalStopName: "Library",
    });
  });

  it("prefers an explicit route update trip id over the session's existing trip", async () => {
    const user = await createUserWithSettings("agent-explicit-trip-switch");
    const oldTrip = await createPlannedTrip({
      userId: user.id,
      rawPrompt: "Old session trip.",
      timezone: "Asia/Shanghai",
      title: "Home-OldOffice",
      finalStopName: "OldOffice",
      stops: [
        {
          order: 1,
          name: "OldOffice",
          lngLat: "121.2,29.2",
          kind: "destination",
        },
      ],
      legs: [
        {
          order: 1,
          originName: "Home",
          originLngLat: "121.1,29.1",
          destinationName: "OldOffice",
          destinationLngLat: "121.2,29.2",
          routeMinutes: 30,
          bufferComponents: [
            {
              category: "transfer",
              label: "Transfer",
              minutes: 5,
              reason: "Leave time for transfer.",
            },
          ],
        },
      ],
    });
    const anotherTrip = await createPlannedTrip({
      userId: user.id,
      rawPrompt: "Another explicit trip.",
      timezone: "Asia/Shanghai",
      title: "Home-AnotherOffice",
      finalStopName: "AnotherOffice",
      stops: [
        {
          order: 1,
          name: "AnotherOffice",
          lngLat: "121.3,29.3",
          kind: "destination",
        },
      ],
      legs: [
        {
          order: 1,
          originName: "Home",
          originLngLat: "121.1,29.1",
          destinationName: "AnotherOffice",
          destinationLngLat: "121.3,29.3",
          routeMinutes: 35,
          bufferComponents: [
            {
              category: "transfer",
              label: "Transfer",
              minutes: 5,
              reason: "Leave time for transfer.",
            },
          ],
        },
      ],
    });
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Switch the continuation to an explicit trip.",
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: "completed", tripId: oldTrip.id },
    });

    let calls = 0;
    const chatClient: AgentChatClient = {
      async complete() {
        calls += 1;
        if (calls === 1) {
          return {
            message: {
              role: "assistant",
              content: "Switch explicit trip.",
              toolCalls: [
                {
                  id: "switch-summary",
                  name: "update_trip_summary",
                  arguments: {
                    tripId: anotherTrip.id,
                    title: "Home-Museum",
                    finalStopName: "Museum",
                  },
                },
              ],
            },
          };
        }

        return {
          message: {
            role: "assistant",
            content: "Explicit trip switched.",
          },
        };
      },
    };

    const result = await continueAgentSession(
      {
        userId: user.id,
        sessionId: session.id,
        message: "Use the explicit trip instead of the old one.",
      },
      { amapClient, chatClient }
    );

    expect(result).toMatchObject({
      status: "completed",
      tripId: anotherTrip.id,
    });
    await expect(
      prisma.agentSession.findUniqueOrThrow({ where: { id: session.id } })
    ).resolves.toMatchObject({
      tripId: anotherTrip.id,
      status: "completed",
    });
    await expect(
      prisma.trip.findUniqueOrThrow({ where: { id: anotherTrip.id } })
    ).resolves.toMatchObject({
      title: "Home-Museum",
      finalStopName: "Museum",
    });
    await expect(
      prisma.trip.findUniqueOrThrow({ where: { id: oldTrip.id } })
    ).resolves.toMatchObject({
      finalStopName: "OldOffice",
    });
  });
});

async function createUserWithSettings(
  label: string,
  extraData: Record<string, unknown> = {}
) {
  return prisma.user.create({
    data: {
      email: `${label}-${Date.now()}-${Math.random()}@example.com`,
      name: label,
      passwordHash: "hash",
      settings: {
        create: {
          defaultCity: "Ningbo",
          timezone: "Asia/Shanghai",
          originName: "Home",
          originLngLat: "121.1,29.1",
          routePreference: "balanced",
        },
      },
      ...extraData,
    },
  });
}

function createTripChatClient(input: {
  finalStopName: string;
  destinationLngLat: string;
  routeMinutes: number;
  mode: string;
  onComplete?: (input: { messages: AgentChatMessage[] }) => void;
}): AgentChatClient {
  return {
    async complete({ messages }) {
      const toolResultCount = messages.filter((message) => message.role === "tool")
        .length;

      if (toolResultCount === 0) {
        return {
          message: {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "call-search-poi",
                name: "search_poi",
                arguments: { keywords: input.finalStopName, city: "Ningbo" },
              },
              {
                id: "call-weather",
                name: "get_weather_reference",
                arguments: { city: "Ningbo" },
              },
              {
                id: "call-transit",
                name: "get_transit_route",
                arguments: {
                  destination: input.destinationLngLat,
                  city: "Ningbo",
                  cityd: "Ningbo",
                },
              },
            ],
          },
        };
      }

      input.onComplete?.({ messages });
      return createTripToolResponse(input);
    },
  };
}

function createTripToolResponse(input: {
  finalStopName: string;
  destinationLngLat: string;
  routeMinutes: number;
  mode: string;
  bufferMinutes?: number;
  totalMinutes?: number;
  routeTitle?: string;
  bufferComponents?: Array<{
    category: string;
    label: string;
    minutes: number;
    reason: string;
    source?: string;
  }>;
}) {
  const bufferComponents =
    input.bufferComponents ?? [
      {
        category: "transfer",
        label: "Transfer buffer",
        minutes: 5,
        reason: "Leave time for station walking.",
      },
    ];
  const bufferMinutes =
    input.bufferMinutes ??
    bufferComponents.reduce((total, component) => total + component.minutes, 0);

  return {
    message: {
      role: "assistant" as const,
      content: "Create final trip.",
      toolCalls: [
        {
          id: "call-create-trip",
          name: "create_trip",
          arguments: {
            title: `Home-${input.finalStopName}`,
            timezone: "Asia/Shanghai",
            finalStopName: input.finalStopName,
            stops: [
              {
                order: 1,
                name: input.finalStopName,
                lngLat: input.destinationLngLat,
                kind: "destination",
              },
            ],
            legs: [
              {
                order: 1,
                originName: "Home",
                originLngLat: "121.1,29.1",
                destinationName: input.finalStopName,
                destinationLngLat: input.destinationLngLat,
                routeMinutes: input.routeMinutes,
                bufferMinutes,
                totalMinutes: input.totalMinutes ?? input.routeMinutes + bufferMinutes,
                mode: input.mode,
                routeTitle: input.routeTitle ?? `${input.mode} route`,
                routeRationale: "AI selected this route from tool evidence.",
                segmentTitle: `${input.mode} segment`,
                segmentDetail: "Generated from deterministic test tools.",
                segmentSource: "amap",
                source: { source: "test-agent" },
                bufferComponents,
              },
            ],
          },
        },
      ],
    },
  };
}
