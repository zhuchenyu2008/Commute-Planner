import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import type { AgentChatClient } from "@/lib/agent/chat-client";
import {
  acceptAgentSessionMessage,
  continueAgentSession,
  runAcceptedContinuationSession,
  runPlanningSession,
  startPlanningSession,
} from "@/lib/agent/planner";
import { createMockAmapClient } from "@/lib/amap/mock";
import { createPlannedTrip } from "@/lib/trips/create-trip";
import { switchTelegramActiveTrip } from "@/lib/telegram/state";
import { ensureTestDatabase } from "./test-db";

type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;

const getCurrentUserMock = vi.hoisted(() =>
  vi.fn<() => Promise<CurrentUser | null>>()
);

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, getCurrentUser: getCurrentUserMock };
});

describe("Batch C RUS-020/RUS-021/RUS-032/RUS-033 agent and API guards", () => {
  const amapClient = createMockAmapClient();

  beforeAll(async () => {
    await ensureTestDatabase();
  });

  beforeEach(() => {
    getCurrentUserMock.mockReset();
  });

  it("RUS-020 rejects duplicate continuation while a session is running and rejects empty messages", async () => {
    const { POST } = await import(
      "@app/api/agent-sessions/[sessionId]/messages/route"
    );
    const user = await createUserWithSettings("rus-020");
    const currentUser = await loadCurrentUser(user.id);
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Plan the original commute.",
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: "completed" },
    });
    getCurrentUserMock.mockResolvedValue(currentUser);

    await expect(
      acceptAgentSessionMessage({
        userId: user.id,
        sessionId: session.id,
        message: "Change the arrival time to 8:45.",
      })
    ).resolves.toMatchObject({ status: "running" });

    const beforeDuplicate = await prisma.agentMessage.count({
      where: { agentSessionId: session.id, role: "user" },
    });
    const duplicateResponse = await POST(
      jsonRequest({ message: "This should be blocked while running." }),
      { params: Promise.resolve({ sessionId: session.id }) }
    );
    const duplicatePayload = await duplicateResponse.json();

    expect(duplicateResponse.status).toBe(409);
    expect(duplicatePayload.error).toEqual(expect.any(String));
    await expect(
      prisma.agentMessage.count({
        where: { agentSessionId: session.id, role: "user" },
      })
    ).resolves.toBe(beforeDuplicate);

    const emptySession = await startPlanningSession({
      userId: user.id,
      prompt: "Plan another commute.",
    });
    await prisma.agentSession.update({
      where: { id: emptySession.id },
      data: { status: "completed" },
    });
    const emptyResponse = await POST(jsonRequest({ message: "   " }), {
      params: Promise.resolve({ sessionId: emptySession.id }),
    });
    const emptyPayload = await emptyResponse.json();

    expect(emptyResponse.status).toBe(400);
    expect(emptyPayload.error).toEqual(expect.any(String));
    await expect(
      prisma.agentSession.findUniqueOrThrow({ where: { id: emptySession.id } })
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("RUS-021 persists failed sessions when planning ends without create_trip", async () => {
    const user = await createUserWithSettings("rus-021-no-create-trip");
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Plan a trip but the planner will stop early.",
    });
    const chatClient: AgentChatClient = {
      async complete() {
        return {
          message: {
            role: "assistant",
            content: "I am done without creating a trip.",
          },
        };
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient,
      chatClient,
    });

    expect(result).toMatchObject({ status: "failed", tripId: null });
    await expect(
      prisma.agentSession.findUniqueOrThrow({
        where: { id: session.id },
        include: { messages: { orderBy: { createdAt: "asc" } }, trip: true },
      })
    ).resolves.toMatchObject({
      status: "failed",
      tripId: null,
      trip: null,
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "assistant" }),
      ]),
    });
    await expect(
      prisma.trip.count({ where: { agentSessionId: session.id } })
    ).resolves.toBe(0);
  });

  it("RUS-021 persists tool-call failures without creating a partial trip", async () => {
    const user = await createUserWithSettings("rus-021-tool-failure");
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Plan with a failing route tool.",
    });
    const chatClient: AgentChatClient = {
      async complete() {
        return {
          message: {
            role: "assistant",
            content: "Call the route tool.",
            toolCalls: [
              {
                id: "failing-route",
                name: "get_transit_route",
                arguments: {
                  origin: "121.1,29.1",
                  destination: "121.2,29.2",
                  city: "Ningbo",
                  cityd: "Ningbo",
                },
              },
            ],
          },
        };
      },
    };
    const failingAmapClient = {
      ...amapClient,
      async getTransitRoute() {
        throw new Error("stubbed AMap route failure");
      },
    };

    const result = await runPlanningSession(session.id, {
      amapClient: failingAmapClient,
      chatClient,
    });

    expect(result).toMatchObject({ status: "failed", tripId: null });
    await expect(
      prisma.agentToolCall.findFirstOrThrow({
        where: { agentSessionId: session.id, name: "get_transit_route" },
      })
    ).resolves.toMatchObject({
      status: "failed",
      error: "stubbed AMap route failure",
    });
    await expect(
      prisma.trip.count({ where: { agentSessionId: session.id } })
    ).resolves.toBe(0);
  });

  it("RUS-021 persists timed_out and aborted sessions with assistant failure messages", async () => {
    const timeoutUser = await createUserWithSettings("rus-021-timeout");
    const timeoutSession = await startPlanningSession({
      userId: timeoutUser.id,
      prompt: "This continuation will time out.",
    });
    await prisma.agentSession.update({
      where: { id: timeoutSession.id },
      data: { status: "running", timeoutMs: 1 },
    });
    const hangingChatClient: AgentChatClient = {
      async complete({ signal }) {
        return new Promise((_, reject) => {
          signal?.addEventListener("abort", () => {
            reject(signal.reason);
          });
        });
      },
    };

    const timeoutResult = await runAcceptedContinuationSession(timeoutSession.id, {
      amapClient,
      chatClient: hangingChatClient,
    });

    expect(timeoutResult).toMatchObject({ status: "timed_out", tripId: null });
    await expect(
      prisma.agentSession.findUniqueOrThrow({
        where: { id: timeoutSession.id },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      })
    ).resolves.toMatchObject({
      status: "timed_out",
      tripId: null,
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "assistant" }),
      ]),
    });

    const abortUser = await createUserWithSettings("rus-021-abort");
    const abortSession = await startPlanningSession({
      userId: abortUser.id,
      prompt: "This planning run will abort.",
    });
    const abortingChatClient: AgentChatClient = {
      async complete() {
        throw new Error("Agent run aborted.");
      },
    };

    const abortResult = await runPlanningSession(abortSession.id, {
      amapClient,
      chatClient: abortingChatClient,
    });

    expect(abortResult).toMatchObject({ status: "failed", tripId: null });
    await expect(
      prisma.agentSession.findUniqueOrThrow({
        where: { id: abortSession.id },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      })
    ).resolves.toMatchObject({
      status: "failed",
      tripId: null,
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "assistant" }),
      ]),
    });
  });

  it("RUS-032 prevents User B from reading or mutating User A resources by id", async () => {
    const agentDetail = await import("@app/api/agent-sessions/[sessionId]/route");
    const agentMessages = await import(
      "@app/api/agent-sessions/[sessionId]/messages/route"
    );
    const cancelMonitoring = await import(
      "@app/api/trips/[tripId]/cancel-monitoring/route"
    );
    const confirmMemory = await import(
      "@app/api/memory-candidates/[candidateId]/confirm/route"
    );

    const owner = await createUserWithSettings("rus-032-owner", {
      telegramChatId: `owner-chat-${Date.now()}`,
    });
    const intruder = await createUserWithSettings("rus-032-intruder", {
      telegramChatId: `intruder-chat-${Date.now()}`,
    });
    const trip = await createTrip(owner.id, "Owner private trip");
    const session = await startPlanningSession({
      userId: owner.id,
      prompt: "Private owner session.",
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: "completed", tripId: trip.id },
    });
    const candidate = await prisma.memoryCandidate.create({
      data: {
        userId: owner.id,
        kind: "preference",
        label: "Owner private preference",
        valueJson: JSON.stringify({ mode: "transit" }),
      },
    });
    await prisma.telegramChatState.create({
      data: {
        chatId: `owner-state-${Date.now()}`,
        userId: owner.id,
        activeAgentSessionId: session.id,
        activeTripId: trip.id,
        mode: "active",
      },
    });
    getCurrentUserMock.mockResolvedValue(await loadCurrentUser(intruder.id));

    const detailResponse = await agentDetail.GET(new Request("http://localhost"), {
      params: Promise.resolve({ sessionId: session.id }),
    });
    expect(detailResponse.status).toBe(404);

    const messageResponse = await agentMessages.POST(
      jsonRequest({ message: "Try to update someone else's session." }),
      { params: Promise.resolve({ sessionId: session.id }) }
    );
    expect(messageResponse.status).toBe(404);

    const cancelResponse = await cancelMonitoring.POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ tripId: trip.id }) }
    );
    expect(cancelResponse.status).toBe(404);

    const confirmResponse = await confirmMemory.POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ candidateId: candidate.id }) }
    );
    expect(confirmResponse.status).toBe(404);

    await expect(
      switchTelegramActiveTrip({
        chatId: `intruder-switch-${Date.now()}`,
        userId: intruder.id,
        tripId: trip.id,
      })
    ).resolves.toEqual({ status: "not_found" });

    await expect(
      prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })
    ).resolves.toMatchObject({ userId: owner.id, status: "monitoring" });
    await expect(
      prisma.memoryCandidate.findUniqueOrThrow({ where: { id: candidate.id } })
    ).resolves.toMatchObject({ userId: owner.id, status: "pending" });
    await expect(
      prisma.agentMessage.count({
        where: {
          agentSessionId: session.id,
          content: "Try to update someone else's session.",
        },
      })
    ).resolves.toBe(0);
  });

  it("RUS-033 returns stable JSON errors for invalid API inputs without partial writes", async () => {
    const agentCreate = await import("@app/api/agent-sessions/route");
    const agentMessages = await import(
      "@app/api/agent-sessions/[sessionId]/messages/route"
    );
    const agentDetail = await import("@app/api/agent-sessions/[sessionId]/route");
    const cancelMonitoring = await import(
      "@app/api/trips/[tripId]/cancel-monitoring/route"
    );
    const confirmMemory = await import(
      "@app/api/memory-candidates/[candidateId]/confirm/route"
    );
    const schedulerTick = await import("@app/api/scheduler/tick/route");
    const user = await createUserWithSettings("rus-033");
    getCurrentUserMock.mockResolvedValue(await loadCurrentUser(user.id));

    const beforeSessions = await prisma.agentSession.count({
      where: { userId: user.id },
    });
    const invalidJson = await agentCreate.POST(
      new Request("http://localhost/api/agent-sessions", {
        method: "POST",
        body: "{",
      })
    );
    await expectJsonError(invalidJson, 400);

    const missingBody = await agentCreate.POST(
      new Request("http://localhost/api/agent-sessions", { method: "POST" })
    );
    await expectJsonError(missingBody, 400);

    const emptyPrompt = await agentCreate.POST(jsonRequest({ prompt: " " }));
    await expectJsonError(emptyPrompt, 400);
    await expect(
      prisma.agentSession.count({ where: { userId: user.id } })
    ).resolves.toBe(beforeSessions);

    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Known session for invalid input tests.",
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: "completed" },
    });
    const emptyMessage = await agentMessages.POST(jsonRequest({ message: "" }), {
      params: Promise.resolve({ sessionId: session.id }),
    });
    await expectJsonError(emptyMessage, 400);
    await expect(
      prisma.agentMessage.count({
        where: { agentSessionId: session.id, role: "user" },
      })
    ).resolves.toBe(1);

    const unknownSessionGet = await agentDetail.GET(
      new Request("http://localhost"),
      { params: Promise.resolve({ sessionId: "unknown-session" }) }
    );
    await expectJsonError(unknownSessionGet, 404);

    const unknownSessionPost = await agentMessages.POST(
      jsonRequest({ message: "hello" }),
      { params: Promise.resolve({ sessionId: "unknown-session" }) }
    );
    await expectJsonError(unknownSessionPost, 404);

    const unknownTrip = await cancelMonitoring.POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ tripId: "unknown-trip" }) }
    );
    await expectJsonError(unknownTrip, 404);

    const unknownCandidate = await confirmMemory.POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ candidateId: "unknown-candidate" }) }
    );
    await expectJsonError(unknownCandidate, 404);

    const unauthorizedTick = await schedulerTick.POST(
      new Request("http://localhost/api/scheduler/tick", { method: "POST" })
    );
    await expectJsonError(unauthorizedTick, 401);
  });
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function expectJsonError(response: Response, status: number) {
  expect(response.status).toBe(status);
  const payload = await response.json();
  expect(payload).toMatchObject({ error: expect.any(String) });
}

async function loadCurrentUser(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { settings: true },
  });
}

async function createUserWithSettings(
  label: string,
  settings: { telegramChatId?: string } = {}
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
          telegramChatId: settings.telegramChatId,
        },
      },
    },
  });
}

async function createTrip(userId: string, title: string) {
  return createPlannedTrip({
    userId,
    rawPrompt: title,
    timezone: "Asia/Shanghai",
    title,
    targetArriveAt: new Date("2026-07-03T01:00:00.000Z"),
    finalStopName: "Office",
    stops: [
      {
        order: 1,
        name: "Office",
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
        destinationName: "Office",
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
}
