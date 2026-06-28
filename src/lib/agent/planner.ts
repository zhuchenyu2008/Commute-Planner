import { createAmapClient } from "@/lib/amap";
import type { RouteResult } from "@/lib/amap";
import { prisma } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { assertAgentRunActive, recordToolCall } from "@/lib/agent/tools";
import type {
  PlanningAttemptResult,
  PlanningSessionResult,
  StartPlanningSessionInput,
} from "@/lib/agent/types";
import { AgentRunTimeoutError, runWithTimeoutAndRetry } from "@/lib/agent/runner";
import { createPlannedTrip } from "@/lib/trips/create-trip";
import type {
  BufferComponentInput,
  PlannedTripLegInput,
  PlannedTripStopInput,
} from "@/lib/trips/types";

const SESSION_TIMEOUT_MS = 600000;
const SESSION_MAX_ATTEMPTS = 2;

type PlanningSettings = {
  defaultCity: string;
  timezone: string;
  originName: string;
  originLngLat: string;
  routePreference: string;
};

const fallbackSettings = (): PlanningSettings => {
  const env = readEnv();
  return {
    defaultCity: env.defaultCity,
    timezone: env.defaultTimezone,
    originName: env.defaultOriginName,
    originLngLat: env.defaultOrigin,
    routePreference: "balanced",
  };
};

function normalizePrompt(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error("Planning prompt is required.");
  }

  return trimmed;
}

function extractDestination(prompt: string) {
  const afterAt = prompt.match(/\bat\s+([^,.;]+?)(?:\s+after\b|$)/i)?.[1];
  const afterTo = prompt.match(/\bto\s+([^,.;]+?)(?:\s+after\b|$)/i)?.[1];
  return (afterAt ?? afterTo ?? prompt).trim();
}

function buildTargetArriveAt(prompt: string) {
  const timeMatch = prompt.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const target = new Date(Date.now() + 24 * 60 * 60 * 1000);

  if (timeMatch) {
    target.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
  }

  return target;
}

function buildBufferComponents(weatherSummary: string): BufferComponentInput[] {
  return [
    {
      category: "venue",
      label: "Venue arrival buffer",
      minutes: 5,
      reason: "Allow time to enter the venue and find the exact meeting place.",
      source: "agent_inference",
    },
    {
      category: "transfer",
      label: "Transfer buffer",
      minutes: 5,
      reason: "Allow time for platform, elevator, parking, or pickup friction.",
      source: "agent_inference",
    },
    {
      category: "weather_context",
      label: "Weather reference",
      minutes: 0,
      reason: `Weather is reference context only: ${weatherSummary}`,
      source: "weather_context",
    },
  ];
}

async function createAssistantMessage(input: {
  sessionId: string;
  content: string;
  metadata?: unknown;
  signal?: AbortSignal;
}) {
  assertAgentRunActive(input.signal);
  const message = await prisma.agentMessage.create({
    data: {
      agentSessionId: input.sessionId,
      role: "assistant",
      content: input.content,
      metadataJson:
        input.metadata === undefined ? undefined : JSON.stringify(input.metadata),
    },
  });
  assertAgentRunActive(input.signal);
  return message;
}

async function readSettings(
  sessionId: string,
  userId: string,
  signal?: AbortSignal
) {
  return recordToolCall({
    agentSessionId: sessionId,
    name: "read_settings",
    request: { userId },
    signal,
    run: async () => {
      const settings = await prisma.userSettings.findUnique({
        where: { userId },
      });

      return settings ?? fallbackSettings();
    },
  });
}

async function readMemories(
  sessionId: string,
  userId: string,
  signal?: AbortSignal
) {
  return recordToolCall({
    agentSessionId: sessionId,
    name: "read_memories",
    request: { userId },
    signal,
    run: async () =>
      prisma.memory.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
  });
}

function createLegInput(params: {
  order: number;
  settings: PlanningSettings;
  destinationName: string;
  destinationLngLat: string;
  targetArriveAt: Date;
  route: RouteResult;
  weatherSummary: string;
}): PlannedTripLegInput {
  const bufferComponents = buildBufferComponents(params.weatherSummary);
  const bufferMinutes = bufferComponents.reduce(
    (total, component) => total + component.minutes,
    0
  );

  return {
    order: params.order,
    originName: params.settings.originName,
    originLngLat: params.settings.originLngLat,
    destinationName: params.destinationName,
    destinationLngLat: params.destinationLngLat,
    routeMinutes: params.route.durationMinutes,
    bufferMinutes,
    totalMinutes: params.route.durationMinutes + bufferMinutes,
    targetArriveAt: params.targetArriveAt,
    mode: params.route.mode,
    routeTitle: params.route.summary,
    routeRationale:
      "Initial route selected from AMap transit data; weather remains auxiliary reference information.",
    segmentTitle: params.route.summary,
    segmentDetail: "AMap route candidate selected for monitoring.",
    segmentSource: "amap",
    source: params.route.raw,
    bufferComponents,
  };
}

export async function startPlanningSession({
  userId,
  prompt,
}: StartPlanningSessionInput) {
  const normalizedPrompt = normalizePrompt(prompt);

  return prisma.agentSession.create({
    data: {
      userId,
      status: "running",
      purpose: "planning",
      prompt: normalizedPrompt,
      timeoutMs: SESSION_TIMEOUT_MS,
      messages: {
        create: {
          role: "user",
          content: normalizedPrompt,
        },
      },
    },
  });
}

export async function runPlanningSession(
  sessionId: string
): Promise<PlanningSessionResult> {
  try {
    const result = await runWithTimeoutAndRetry({
      timeoutMs: SESSION_TIMEOUT_MS,
      maxAttempts: SESSION_MAX_ATTEMPTS,
      run: async ({ attempt, signal }) =>
        runPlanningAttempt(sessionId, attempt, signal),
    });

    await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        status: "completed",
        retryCount: result.attempts - 1,
        tripId: result.value.tripId,
      },
    });

    return {
      sessionId,
      status: "completed",
      tripId: result.value.tripId,
    };
  } catch (error) {
    const timedOut = error instanceof AgentRunTimeoutError;
    const failed = await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        status: timedOut ? "timed_out" : "failed",
        messages: {
          create: {
            role: "assistant",
            content:
              error instanceof Error
                ? `Planning failed: ${error.message}`
                : "Planning failed.",
          },
        },
      },
    });

    return {
      sessionId,
      status: timedOut ? "timed_out" : "failed",
      tripId: failed.tripId,
    };
  }
}

export async function runPlanningAttempt(
  sessionId: string,
  attempt = 1,
  signal?: AbortSignal
): Promise<PlanningAttemptResult> {
  assertAgentRunActive(signal);
  const session = await prisma.agentSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  await createAssistantMessage({
    sessionId,
    signal,
    content: `Planning attempt ${attempt}: reading preferences, reference context, and routes.`,
  });

  const settings = (await readSettings(
    sessionId,
    session.userId,
    signal
  )) as PlanningSettings;
  await readMemories(sessionId, session.userId, signal);

  assertAgentRunActive(signal);
  const amap = createAmapClient();
  const destinationQuery = extractDestination(session.prompt);
  const pois = await recordToolCall({
    agentSessionId: sessionId,
    name: "search_poi",
    request: {
      keywords: destinationQuery,
      city: settings.defaultCity,
    },
    signal,
    run: () =>
      amap.searchPoi({
        keywords: destinationQuery,
        city: settings.defaultCity,
      }),
  });
  const destination = pois[0];

  if (!destination) {
    throw new Error(`No POI found for ${destinationQuery}.`);
  }

  const weather = await recordToolCall({
    agentSessionId: sessionId,
    name: "get_weather_reference",
    request: { city: settings.defaultCity },
    signal,
    run: () => amap.getWeather({ city: settings.defaultCity }),
  });

  await createAssistantMessage({
    sessionId,
    signal,
    content: `Weather is reference context only: ${weather.summary}`,
    metadata: { weather },
  });

  const routeRequest = {
    origin: settings.originLngLat,
    destination: destination.lngLat,
    city: settings.defaultCity,
    cityd: settings.defaultCity,
  };
  const transitRoute = await recordToolCall({
    agentSessionId: sessionId,
    name: "get_transit_route",
    request: routeRequest,
    signal,
    run: () => amap.getTransitRoute(routeRequest),
  });

  assertAgentRunActive(signal);
  const targetArriveAt = buildTargetArriveAt(session.prompt);
  const stop: PlannedTripStopInput = {
    order: 1,
    name: destination.name,
    address: destination.address,
    lngLat: destination.lngLat,
    targetArriveAt,
    kind: "destination",
    notes:
      "Destination resolved by agent POI search. Additional stops can be added as ordered destination stops.",
  };
  const leg = createLegInput({
    order: 1,
    settings,
    destinationName: destination.name,
    destinationLngLat: destination.lngLat,
    targetArriveAt,
    route: transitRoute,
    weatherSummary: weather.summary,
  });

  let createdTripId: string | null = null;
  try {
    const trip = await recordToolCall({
      agentSessionId: sessionId,
      name: "create_trip",
      request: {
        title: destination.name,
        stop,
        leg,
      },
      signal,
      run: async () => {
        assertAgentRunActive(signal);
        const created = await createPlannedTrip({
          userId: session.userId,
          agentSessionId: sessionId,
          rawPrompt: session.prompt,
          timezone: settings.timezone,
          title: destination.name,
          targetArriveAt,
          finalStopName: destination.name,
          stops: [stop],
          legs: [leg],
        });
        createdTripId = created.id;
        assertAgentRunActive(signal);
        return created;
      },
    });

    await createAssistantMessage({
      sessionId,
      signal,
      content: `Created monitored trip to ${destination.name} with venue, transfer, and weather reference buffers.`,
      metadata: { tripId: trip.id },
    });

    return {
      tripId: trip.id,
      summary: `Planned trip to ${destination.name}.`,
    };
  } catch (error) {
    if (createdTripId && signal?.aborted) {
      await prisma.trip.delete({ where: { id: createdTripId } }).catch(() => undefined);
    }
    throw error;
  }
}
