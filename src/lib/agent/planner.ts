import { createAmapClient } from "@/lib/amap";
import type { AmapClient } from "@/lib/amap";
import { prisma } from "@/lib/db";
import { readEnv } from "@/lib/env";
import type {
  AgentChatClient,
  AgentChatMessage,
  AgentChatToolCall,
  AgentChatToolDefinition,
} from "@/lib/agent/chat-client";
import { createOpenAiChatClient } from "@/lib/agent/chat-client";
import { assertAgentRunActive, recordToolCall } from "@/lib/agent/tools";
import { buildConfirmedMemoryContext } from "@/lib/memories/context";
import type {
  AgentToolName,
  ContinueAgentSessionInput,
  PlanningAttemptResult,
  PlanningSessionResult,
  StartPlanningSessionInput,
} from "@/lib/agent/types";
import {
  AgentRunTimeoutError,
  runWithTimeoutAndRetry,
} from "@/lib/agent/runner";
import { createPlannedTrip } from "@/lib/trips/create-trip";
import {
  cancelTripMonitoring,
  createMemoryCandidateForTrip,
  replaceReminderSchedule,
  replaceTripRoute,
  selectRouteCandidate,
  updateTripSummary,
} from "@/lib/trips/route-updates";
import type {
  BufferComponentInput,
  CreatePlannedTripInput,
  PlannedTripLegInput,
  PlannedTripStopInput,
} from "@/lib/trips/types";

const SESSION_TIMEOUT_MS = 600000;
const SESSION_MAX_ATTEMPTS = 2;
const ORIGIN_REQUIRED_MESSAGE =
  "请先在设置中选择默认出发点，或在本次请求中提供出发点。";

export { AgentRunTimeoutError };

export class AgentSessionAlreadyRunningError extends Error {
  constructor() {
    super("Agent session is already running.");
    this.name = "AgentSessionAlreadyRunningError";
  }
}

export class AgentSessionNotFoundError extends Error {
  constructor() {
    super("Agent session not found.");
    this.name = "AgentSessionNotFoundError";
  }
}

type PlanningSettings = {
  defaultCity: string;
  timezone: string;
  originName: string;
  originLngLat: string;
  routePreference: string;
};

export type RunPlanningSessionOptions = {
  chatClient?: AgentChatClient;
  amapClient?: AmapClient;
};

type ToolExecutionContext = {
  amap: AmapClient;
  sessionId: string;
  userId: string;
  prompt: string;
  tripId?: string | null;
  signal?: AbortSignal;
};

const fallbackSettings = (): PlanningSettings => {
  const env = readEnv();
  return {
    defaultCity: env.defaultCity,
    timezone: env.defaultTimezone,
    originName: "",
    originLngLat: "",
    routePreference: "balanced",
  };
};

function normalizePlanningSettings(settings: {
  defaultCity: string;
  timezone: string;
  originName: string | null;
  originLngLat: string | null;
  routePreference: string;
}): PlanningSettings {
  return {
    defaultCity: settings.defaultCity,
    timezone: settings.timezone,
    originName: settings.originName ?? "",
    originLngLat: settings.originLngLat ?? "",
    routePreference: settings.routePreference,
  };
}

function normalizePrompt(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error("请输入通勤规划需求。");
  }

  return trimmed;
}

export function formatPlanningFailureMessage(error: unknown) {
  if (error instanceof AgentRunTimeoutError) {
    return "规划失败：智能体规划超时，请稍后重试。";
  }

  if (error instanceof Error) {
    const knownMessages: Record<string, string> = {
      "Agent run aborted.": "规划失败：智能体运行已中止。",
      "timeoutMs must be greater than zero.":
        "规划失败：内部运行超时配置无效。",
      "maxAttempts must be greater than zero.":
        "规划失败：内部重试配置无效。",
      "Agent planning failed after all attempts.":
        "规划失败：多次尝试后仍未完成，请稍后重试。",
    };

    return knownMessages[error.message] ?? `规划失败：${error.message}`;
  }

  return "规划失败：请稍后重试。";
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

function objectParameters(
  properties: Record<string, unknown>,
  required: string[] = []
) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function arrayOfItems(items: Record<string, unknown>) {
  return {
    type: "array",
    items,
  };
}

const bufferComponentSchema = objectParameters(
  {
    category: { type: "string" },
    label: { type: "string" },
    minutes: { type: "number" },
    reason: { type: "string" },
    source: {
      type: "string",
      enum: [
        "agent_inference",
        "user_setting",
        "memory",
        "weather_context",
        "manual_override",
      ],
    },
  },
  ["category", "label", "minutes", "reason"]
);

const stopSchema = objectParameters(
  {
    order: { type: "number" },
    name: { type: "string" },
    address: { type: "string" },
    lngLat: { type: "string" },
    targetArriveAt: { type: "string" },
    plannedStayMin: { type: "number" },
    kind: { type: "string" },
    notes: { type: "string" },
  },
  ["name"]
);

const legSchema = objectParameters(
  {
    order: { type: "number" },
    originName: { type: "string" },
    originLngLat: { type: "string" },
    destinationName: { type: "string" },
    destinationLngLat: { type: "string" },
    routeMinutes: { type: "number" },
    bufferMinutes: { type: "number" },
    totalMinutes: { type: "number" },
    bufferComponents: arrayOfItems(bufferComponentSchema),
    latestDepartAt: { type: "string" },
    targetArriveAt: { type: "string" },
    mode: { type: "string" },
    routeTitle: { type: "string" },
    routeRationale: { type: "string" },
    segmentTitle: { type: "string" },
    segmentDetail: { type: "string" },
    segmentSource: { type: "string" },
    source: { type: "object" },
  },
  [
    "originName",
    "originLngLat",
    "destinationName",
    "routeMinutes",
    "bufferComponents",
  ]
);

const TOOL_DEFINITIONS: AgentChatToolDefinition[] = [
  {
    name: "read_settings",
    description: "Read the user's city, timezone, default origin, and route preference.",
    parameters: objectParameters({}),
  },
  {
    name: "read_memories",
    description: "Read confirmed commute memories and preferences.",
    parameters: objectParameters({}),
  },
  {
    name: "search_poi",
    description: "Search AMap POIs by keyword.",
    parameters: objectParameters(
      {
        keywords: { type: "string" },
        city: { type: "string" },
      },
      ["keywords"]
    ),
  },
  {
    name: "get_poi_detail",
    description: "Read AMap POI details.",
    parameters: objectParameters({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "get_weather_reference",
    description:
      "Read AMap weather as reference evidence. The application does not hard-code weather rules.",
    parameters: objectParameters({ city: { type: "string" } }, ["city"]),
  },
  {
    name: "get_transit_route",
    description: "Query AMap transit route.",
    parameters: objectParameters(
      {
        origin: { type: "string" },
        destination: { type: "string" },
        city: { type: "string" },
        cityd: { type: "string" },
      },
      ["origin", "destination"]
    ),
  },
  {
    name: "get_walking_route",
    description: "Query AMap walking route.",
    parameters: objectParameters(
      {
        origin: { type: "string" },
        destination: { type: "string" },
        city: { type: "string" },
        cityd: { type: "string" },
      },
      ["origin", "destination"]
    ),
  },
  {
    name: "get_bicycling_route",
    description: "Query AMap bicycling route.",
    parameters: objectParameters(
      {
        origin: { type: "string" },
        destination: { type: "string" },
        city: { type: "string" },
        cityd: { type: "string" },
      },
      ["origin", "destination"]
    ),
  },
  {
    name: "create_trip",
    description:
      "Create the final planned trip after the AI has gathered evidence and made a decision.",
    parameters: objectParameters(
      {
        title: { type: "string" },
        timezone: { type: "string" },
        targetArriveAt: { type: "string" },
        finalStopName: { type: "string" },
        stops: arrayOfItems(stopSchema),
        legs: arrayOfItems(legSchema),
      },
      ["title", "timezone", "stops", "legs"]
    ),
  },
  {
    name: "read_current_trip",
    description:
      "Read the current trip with stops, legs, route candidates, buffers, segments, and reminders.",
    parameters: objectParameters({ tripId: { type: "string" } }),
  },
  {
    name: "update_trip_summary",
    description:
      "Update the current trip summary: title, final stop, target arrival, and status.",
    parameters: objectParameters({
      tripId: { type: "string" },
      title: { type: "string" },
      finalStopName: { type: "string" },
      targetArriveAt: { type: "string" },
      status: { type: "string" },
    }),
  },
  {
    name: "replace_trip_stops",
    description:
      "Replace trip stops. Provide legs too to rebuild the complete route transactionally.",
    parameters: objectParameters({
      tripId: { type: "string" },
      title: { type: "string" },
      finalStopName: { type: "string" },
      targetArriveAt: { type: "string" },
      stops: arrayOfItems(stopSchema),
      legs: arrayOfItems(legSchema),
    }),
  },
  {
    name: "replace_trip_legs",
    description:
      "Replace trip legs. Provide stops too to rebuild the complete route transactionally.",
    parameters: objectParameters({
      tripId: { type: "string" },
      title: { type: "string" },
      finalStopName: { type: "string" },
      targetArriveAt: { type: "string" },
      stops: arrayOfItems(stopSchema),
      legs: arrayOfItems(legSchema),
    }),
  },
  {
    name: "select_route_candidate",
    description: "Select an existing route candidate for a trip leg.",
    parameters: objectParameters({
      tripId: { type: "string" },
      legId: { type: "string" },
      legOrder: { type: "number" },
      candidateId: { type: "string" },
      candidateKey: { type: "string" },
    }),
  },
  {
    name: "replace_reminder_schedule",
    description: "Regenerate reminder jobs from the current latest departure times.",
    parameters: objectParameters({
      tripId: { type: "string" },
      legId: { type: "string" },
      legOrder: { type: "number" },
      cadenceMinutes: arrayOfItems({ type: "number" }),
    }),
  },
  {
    name: "cancel_trip_monitoring",
    description: "Cancel monitoring for the current trip and scheduled reminders.",
    parameters: objectParameters({ tripId: { type: "string" } }),
  },
  {
    name: "create_memory_candidate",
    description: "Create a pending memory candidate for user confirmation.",
    parameters: objectParameters(
      {
        tripId: { type: "string" },
        kind: { type: "string" },
        label: { type: "string" },
        valueJson: {},
      },
      ["kind", "label", "valueJson"]
    ),
  },
];

const SYSTEM_PROMPT = `You are a personal commute-planning AI. Current dates should be interpreted in Beijing time.
You must plan, calculate, compare, and decide yourself. The app only exposes tools; it will not hard-code route ranking, destination extraction, or buffer minutes for you.
Available tools include user settings, memories, all AMap POI/weather/transit/walking/bicycling tools, create_trip, and current-route update tools. You may call tools for as many rounds as needed before timeout. Weather, route results, user preferences, and memories are evidence for your decision, not fixed app rules.
You should actively adapt to weather evidence. In 恶劣天气 such as heavy rain, storms, extreme heat, strong wind, or snow, compare options with less exposed walking or bicycling when possible. If you still choose 长距离步行 or bicycling in bad weather, explain why it remains acceptable, and reflect the weather impact in route rationale and bufferComponents with meaningful minutes when extra time is needed.
Actively capture stable user preferences. When the user says phrases such as 我习惯, 我偏好, 我不喜欢, 以后都, 通常, or similar durable commute habits, call create_memory_candidate with a concise label and structured valueJson so the user can confirm it later.
Final user-facing replies must be plain text without Markdown formatting, headings, code ticks, or list markers.`;

async function createInitialMessages(
  session: { prompt: string; userId: string },
  attempt: number
) {
  const memoryContext = await buildConfirmedMemoryContext(session.userId);
  const messages: AgentChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: memoryContext },
    {
      role: "user",
      content: `第 ${attempt} 次规划尝试：${session.prompt}`,
    },
  ];

  return messages;
}

async function createContinuationMessages(session: {
  id: string;
  prompt: string;
  userId: string;
  tripId: string | null;
}) {
  const memoryContext = await buildConfirmedMemoryContext(session.userId);
  const persistedMessages = await prisma.agentMessage.findMany({
    where: { agentSessionId: session.id },
    orderBy: { createdAt: "asc" },
  });

  const messages: AgentChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: memoryContext },
    {
      role: "system",
      content:
        "Continue the existing planning session. All planning and route update tools are available. You may call tools for as many rounds as needed until timeout. If a current trip exists, use route update tools to revise it instead of assuming the app will update it for you.",
    },
    {
      role: "system",
      content: `Original planning prompt: ${session.prompt}. Current trip id: ${
        session.tripId ?? "none"
      }.`,
    },
  ];

  for (const message of persistedMessages) {
    if (
      message.role === "system" ||
      message.role === "user" ||
      message.role === "assistant"
    ) {
      messages.push({
        role: message.role,
        content: message.content,
      });
    }
  }

  return messages;
}

function getToolName(name: string): AgentToolName {
  const allowed = new Set(
    TOOL_DEFINITIONS.map((tool) => tool.name as AgentToolName)
  );

  if (!allowed.has(name as AgentToolName)) {
    throw new Error(`Unknown agent tool: ${name}`);
  }

  return name as AgentToolName;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readString(
  value: Record<string, unknown>,
  key: string,
  fallback?: string
) {
  const raw = value[key];
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(`Missing string tool argument: ${key}`);
}

function readOptionalString(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function readOptionalNumber(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Tool argument ${key} must be a number.`);
  }

  return numeric;
}

function readNumber(value: Record<string, unknown>, key: string) {
  const numeric = readOptionalNumber(value, key);
  if (numeric === undefined) {
    throw new Error(`Missing number tool argument: ${key}`);
  }

  return numeric;
}

function readOptionalDate(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Tool argument ${key} is not a valid date.`);
  }

  return date;
}

function readArray(value: Record<string, unknown>, key: string): unknown[] {
  const raw = value[key];
  if (!Array.isArray(raw)) {
    throw new Error(`Tool argument ${key} must be an array.`);
  }

  return raw;
}

function readOptionalArray(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (!Array.isArray(raw)) {
    throw new Error(`Tool argument ${key} must be an array.`);
  }

  return raw;
}

function firstNonEmptyString(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim())
    ?.trim();
}

function normalizeBufferComponent(value: unknown): BufferComponentInput {
  const component = requireObject(value, "bufferComponents[]");
  return {
    category: readString(component, "category"),
    label: readString(component, "label"),
    minutes: readNumber(component, "minutes"),
    reason: readString(component, "reason"),
    source: readOptionalString(component, "source") as
      | BufferComponentInput["source"]
      | undefined,
  };
}

function normalizeStop(value: unknown): PlannedTripStopInput {
  const stop = requireObject(value, "stops[]");
  return {
    order: readOptionalNumber(stop, "order"),
    name: readString(stop, "name"),
    address: readOptionalString(stop, "address"),
    lngLat: readOptionalString(stop, "lngLat"),
    targetArriveAt: readOptionalDate(stop, "targetArriveAt"),
    plannedStayMin: readOptionalNumber(stop, "plannedStayMin"),
    kind: readOptionalString(stop, "kind"),
    notes: readOptionalString(stop, "notes"),
  };
}

function normalizeLeg(value: unknown): PlannedTripLegInput {
  const leg = requireObject(value, "legs[]");
  return {
    order: readOptionalNumber(leg, "order"),
    originName: readOptionalString(leg, "originName"),
    originLngLat: readOptionalString(leg, "originLngLat"),
    destinationName: readOptionalString(leg, "destinationName"),
    destinationLngLat: readOptionalString(leg, "destinationLngLat"),
    routeMinutes: readNumber(leg, "routeMinutes"),
    bufferMinutes: readOptionalNumber(leg, "bufferMinutes"),
    totalMinutes: readOptionalNumber(leg, "totalMinutes"),
    bufferComponents: readArray(leg, "bufferComponents").map(
      normalizeBufferComponent
    ),
    latestDepartAt: readOptionalDate(leg, "latestDepartAt"),
    targetArriveAt: readOptionalDate(leg, "targetArriveAt"),
    mode: readOptionalString(leg, "mode"),
    routeTitle: readOptionalString(leg, "routeTitle"),
    routeRationale: readOptionalString(leg, "routeRationale"),
    segmentTitle: readOptionalString(leg, "segmentTitle"),
    segmentDetail: readOptionalString(leg, "segmentDetail"),
    segmentSource: readOptionalString(leg, "segmentSource"),
    source: leg.source,
  };
}

function normalizeCreateTripInput(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  settings: PlanningSettings
): CreatePlannedTripInput {
  return {
    userId: context.userId,
    agentSessionId: context.sessionId,
    rawPrompt: context.prompt,
    timezone: readString(args, "timezone", settings.timezone),
    title: readString(args, "title"),
    targetArriveAt: readOptionalDate(args, "targetArriveAt"),
    finalStopName: readOptionalString(args, "finalStopName"),
    stops: readArray(args, "stops").map(normalizeStop),
    legs: readArray(args, "legs").map(normalizeLeg),
  };
}

function readTripId(args: Record<string, unknown>, context: ToolExecutionContext) {
  const tripId = readOptionalString(args, "tripId") ?? context.tripId;
  if (!tripId) {
    throw new Error("The current session has no associated trip.");
  }

  return tripId;
}

async function readCurrentTrip(context: ToolExecutionContext, tripId: string) {
  return recordToolCall({
    agentSessionId: context.sessionId,
    name: "read_current_trip",
    request: { tripId },
    signal: context.signal,
    run: () =>
      prisma.trip.findFirstOrThrow({
        where: { id: tripId, userId: context.userId },
        include: {
          stops: { orderBy: { order: "asc" } },
          legs: {
            orderBy: { order: "asc" },
            include: {
              selectedCandidate: true,
              routeCandidates: { orderBy: { createdAt: "asc" } },
              routeSegments: { orderBy: { order: "asc" } },
              bufferComponents: { orderBy: { order: "asc" } },
              reminderJobs: { orderBy: { scheduledFor: "asc" } },
            },
          },
          reminderJobs: { orderBy: { scheduledFor: "asc" } },
        },
      }),
  });
}

async function loadCurrentRouteInputs(tripId: string, userId: string) {
  const trip = await prisma.trip.findFirstOrThrow({
    where: { id: tripId, userId },
    include: {
      stops: { orderBy: { order: "asc" } },
      legs: {
        orderBy: { order: "asc" },
        include: {
          selectedCandidate: true,
          bufferComponents: { orderBy: { order: "asc" } },
          routeSegments: { orderBy: { order: "asc" } },
        },
      },
    },
  });

  return {
    trip,
    stops: trip.stops.map((stop) => ({
      order: stop.order,
      name: stop.name,
      address: stop.address ?? undefined,
      lngLat: stop.lngLat ?? undefined,
      targetArriveAt: stop.targetArriveAt ?? undefined,
      plannedStayMin: stop.plannedStayMin ?? undefined,
      kind: stop.kind,
      notes: stop.notes ?? undefined,
    })),
    legs: trip.legs.map((leg) => ({
      order: leg.order,
      originName: leg.originName,
      originLngLat: leg.originLngLat,
      destinationName: leg.destinationName,
      destinationLngLat: leg.destinationLngLat ?? undefined,
      routeMinutes: leg.selectedCandidate?.routeMinutes ?? 30,
      bufferMinutes: leg.selectedCandidate?.bufferMinutes ?? undefined,
      totalMinutes: leg.selectedCandidate?.totalMinutes ?? undefined,
      latestDepartAt: leg.latestDepartAt ?? undefined,
      targetArriveAt: leg.targetArriveAt ?? undefined,
      mode: leg.selectedCandidate?.mode ?? undefined,
      routeTitle: leg.selectedCandidate?.title ?? undefined,
      routeRationale: leg.selectedCandidate?.rationale ?? undefined,
      segmentTitle: leg.routeSegments[0]?.title,
      segmentDetail: leg.routeSegments[0]?.detail ?? undefined,
      segmentSource: leg.routeSegments[0]?.source,
      bufferComponents: leg.bufferComponents.map((component) => ({
        category: component.category,
        label: component.label,
        minutes: component.minutes,
        reason: component.reason,
        source: component.source as BufferComponentInput["source"],
      })),
    })),
  };
}

async function normalizeReplaceRouteInput(
  args: Record<string, unknown>,
  context: ToolExecutionContext
) {
  const tripId = readTripId(args, context);
  const current = await loadCurrentRouteInputs(tripId, context.userId);
  const stopArgs = readOptionalArray(args, "stops");
  const legArgs = readOptionalArray(args, "legs");
  const stops = stopArgs ? stopArgs.map(normalizeStop) : current.stops;
  const legs = legArgs ? legArgs.map(normalizeLeg) : current.legs;

  if (!stops.length || !legs.length) {
    throw new Error(
      "Replacing stops or legs requires complete route data or an existing route to merge with."
    );
  }

  return {
    tripId,
    userId: context.userId,
    title: readOptionalString(args, "title") ?? current.trip.title,
    finalStopName:
      readOptionalString(args, "finalStopName") ??
      current.trip.finalStopName ??
      legs[legs.length - 1]?.destinationName ??
      stops[stops.length - 1]?.name,
    targetArriveAt:
      readOptionalDate(args, "targetArriveAt") ??
      current.trip.targetArriveAt ??
      undefined,
    status: readOptionalString(args, "status") ?? "monitoring",
    stops,
    legs,
  };
}

async function readSettings(context: ToolExecutionContext) {
  return recordToolCall({
    agentSessionId: context.sessionId,
    name: "read_settings",
    request: { userId: context.userId },
    signal: context.signal,
    run: async () => {
      const settings = await prisma.userSettings.findUnique({
        where: { userId: context.userId },
      });

      return settings ? normalizePlanningSettings(settings) : fallbackSettings();
    },
  });
}

async function loadPlanningSettings(userId: string): Promise<PlanningSettings> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
  });

  return settings ? normalizePlanningSettings(settings) : fallbackSettings();
}

async function executeToolCall(
  toolCall: AgentChatToolCall,
  context: ToolExecutionContext,
  settings: PlanningSettings
) {
  const name = getToolName(toolCall.name);
  const args = requireObject(toolCall.arguments, `${name} arguments`);
  const amap = context.amap;

  if (name === "read_settings") {
    return readSettings(context);
  }

  if (name === "read_memories") {
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request: { userId: context.userId },
      signal: context.signal,
      run: async () =>
        prisma.memory.findMany({
          where: { userId: context.userId },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
    });
  }

  if (name === "search_poi") {
    const request = {
      keywords: readString(args, "keywords"),
      city: readOptionalString(args, "city") ?? settings.defaultCity,
    };
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: () => amap.searchPoi(request),
    });
  }

  if (name === "get_poi_detail") {
    const request = { id: readString(args, "id") };
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: () => amap.getPoiDetail(request),
    });
  }

  if (name === "get_weather_reference") {
    const request = {
      city: readOptionalString(args, "city") ?? settings.defaultCity,
    };
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: () => amap.getWeather(request),
    });
  }

  if (
    name === "get_transit_route" ||
    name === "get_walking_route" ||
    name === "get_bicycling_route"
  ) {
    const origin = firstNonEmptyString(
      readOptionalString(args, "origin"),
      settings.originLngLat
    );
    const request = {
      origin: origin ?? "",
      destination: readString(args, "destination"),
      city: readOptionalString(args, "city") ?? settings.defaultCity,
      cityd: readOptionalString(args, "cityd") ?? settings.defaultCity,
    };
    const route =
      name === "get_transit_route"
        ? () => amap.getTransitRoute(request)
        : name === "get_walking_route"
          ? () => amap.getWalkingRoute(request)
          : () => amap.getBicyclingRoute(request);

    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: async () => {
        if (!request.origin) {
          throw new Error(ORIGIN_REQUIRED_MESSAGE);
        }

        return route();
      },
    });
  }

  if (name === "read_current_trip") {
    return readCurrentTrip(context, readTripId(args, context));
  }

  if (name === "update_trip_summary") {
    const tripId = readTripId(args, context);
    const request = {
      tripId,
      userId: context.userId,
      title: readOptionalString(args, "title"),
      finalStopName: readOptionalString(args, "finalStopName"),
      targetArriveAt: readOptionalDate(args, "targetArriveAt"),
      status: readOptionalString(args, "status"),
    };
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: () => updateTripSummary(request),
    });
  }

  if (name === "replace_trip_stops" || name === "replace_trip_legs") {
    const request = await normalizeReplaceRouteInput(args, context);
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: async () => {
        const updated = await replaceTripRoute(request);
        context.tripId = updated.id;
        return updated;
      },
    });
  }

  if (name === "select_route_candidate") {
    const request = {
      tripId: readTripId(args, context),
      userId: context.userId,
      legId: readOptionalString(args, "legId"),
      legOrder: readOptionalNumber(args, "legOrder"),
      candidateId: readOptionalString(args, "candidateId"),
      candidateKey: readOptionalString(args, "candidateKey"),
    };
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: () => selectRouteCandidate(request),
    });
  }

  if (name === "replace_reminder_schedule") {
    const cadence = readOptionalArray(args, "cadenceMinutes")?.map((value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        throw new Error("cadenceMinutes must contain only numbers.");
      }
      return numeric;
    });
    const request = {
      tripId: readTripId(args, context),
      userId: context.userId,
      legId: readOptionalString(args, "legId"),
      legOrder: readOptionalNumber(args, "legOrder"),
      cadenceMinutes: cadence,
    };
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: () => replaceReminderSchedule(request),
    });
  }

  if (name === "cancel_trip_monitoring") {
    const request = {
      tripId: readTripId(args, context),
      userId: context.userId,
    };
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: () => cancelTripMonitoring(request),
    });
  }

  if (name === "create_memory_candidate") {
    const request = {
      tripId: readOptionalString(args, "tripId") ?? context.tripId,
      userId: context.userId,
      kind: readString(args, "kind"),
      label: readString(args, "label"),
      valueJson: args.valueJson,
    };
    return recordToolCall({
      agentSessionId: context.sessionId,
      name,
      request,
      signal: context.signal,
      run: () => createMemoryCandidateForTrip(request),
    });
  }

  const input = normalizeCreateTripInput(args, context, settings);
  let createdTripId: string | null = null;

  try {
    return await recordToolCall({
      agentSessionId: context.sessionId,
      name: "create_trip",
      request: input,
      signal: context.signal,
      run: async () => {
        const created = await createPlannedTrip(input);
        createdTripId = created.id;
        assertAgentRunActive(context.signal);
        return created;
      },
    });
  } catch (error) {
    if (createdTripId && context.signal?.aborted) {
      await prisma.trip
        .delete({ where: { id: createdTripId } })
        .catch(() => undefined);
    }

    throw error;
  }
}

function stringifyToolResult(result: unknown) {
  return JSON.stringify(result, (_key, value: unknown) => {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return value;
  });
}

const CONTINUATION_COMPLETION_TOOL_NAMES = new Set([
  "replace_trip_stops",
  "replace_trip_legs",
  "cancel_trip_monitoring",
]);

function shouldCompleteContinuationAfterTools(
  toolCalls: AgentChatToolCall[],
  requireCreateTrip: boolean
) {
  return (
    !requireCreateTrip &&
    toolCalls.some((toolCall) =>
      CONTINUATION_COMPLETION_TOOL_NAMES.has(toolCall.name)
    )
  );
}

async function runConversationAttempt(input: {
  sessionId: string;
  context: ToolExecutionContext;
  settings: PlanningSettings;
  messages: AgentChatMessage[];
  chatClient: AgentChatClient;
  signal?: AbortSignal;
  requireCreateTrip: boolean;
}) {
  let latestTripId = input.context.tripId ?? null;

  while (true) {
    assertAgentRunActive(input.signal);
    const completion = await input.chatClient.complete({
      messages: input.messages,
      tools: TOOL_DEFINITIONS,
      signal: input.signal,
    });
    const assistantMessage = completion.message;
    input.messages.push(assistantMessage);

    await createAssistantMessage({
      sessionId: input.sessionId,
      signal: input.signal,
      content: assistantMessage.content || "AI 已请求调用工具。",
      metadata: {
        toolCalls: assistantMessage.toolCalls?.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.name,
        })),
      },
    });

    const toolCalls = assistantMessage.toolCalls ?? [];
    if (toolCalls.length === 0) {
      if (input.requireCreateTrip) {
        throw new Error("AI 结束了规划，但没有调用 create_trip。");
      }

      return {
        tripId: latestTripId,
        summary: assistantMessage.content,
      };
    }

    for (const toolCall of toolCalls) {
      assertAgentRunActive(input.signal);
      const result = await executeToolCall(
        toolCall,
        input.context,
        input.settings
      );
      const explicitTripId = readOptionalString(toolCall.arguments, "tripId");
      if (explicitTripId) {
        input.context.tripId = explicitTripId;
      }
      latestTripId = explicitTripId ?? input.context.tripId ?? latestTripId;
      input.messages.push({
        role: "tool",
        toolCallId: toolCall.id,
        content: stringifyToolResult(result),
      });

      if (toolCall.name === "create_trip") {
        const trip = result as { id: string };
        latestTripId = trip.id;
        input.context.tripId = trip.id;

        if (input.requireCreateTrip) {
          await createAssistantMessage({
            sessionId: input.sessionId,
            signal: input.signal,
            content: "AI 已创建规划行程。",
            metadata: { tripId: trip.id },
          });

          return {
            tripId: trip.id,
            summary: "AI 已通过工具调用完成通勤规划。",
          };
        }
      }
    }

    if (shouldCompleteContinuationAfterTools(toolCalls, input.requireCreateTrip)) {
      const summary = "AI 已更新当前行程。";
      await createAssistantMessage({
        sessionId: input.sessionId,
        signal: input.signal,
        content: summary,
        metadata: { tripId: latestTripId },
      });

      return {
        tripId: latestTripId,
        summary,
      };
    }
  }
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
  sessionId: string,
  options: RunPlanningSessionOptions = {}
): Promise<PlanningSessionResult> {
  try {
    const result = await runWithTimeoutAndRetry({
      timeoutMs: SESSION_TIMEOUT_MS,
      maxAttempts: SESSION_MAX_ATTEMPTS,
      run: async ({ attempt, signal }) =>
        runPlanningAttempt(sessionId, attempt, signal, options),
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
            content: formatPlanningFailureMessage(error),
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

export async function continueAgentSession(
  input: ContinueAgentSessionInput,
  options: RunPlanningSessionOptions = {}
): Promise<PlanningSessionResult> {
  const accepted = await acceptAgentSessionMessage(input);
  return runAcceptedContinuationSession(accepted.id, options);
}

export async function acceptAgentSessionMessage({
  userId,
  sessionId,
  message,
}: ContinueAgentSessionInput) {
  const normalizedMessage = normalizePrompt(message);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.agentSession.updateMany({
      where: {
        id: sessionId,
        userId,
        status: { not: "running" },
      },
      data: { status: "running" },
    });

    if (claimed.count !== 1) {
      const existing = await tx.agentSession.findFirst({
        where: { id: sessionId, userId },
      });

      if (!existing) {
        throw new AgentSessionNotFoundError();
      }

      throw new AgentSessionAlreadyRunningError();
    }

    await tx.agentMessage.create({
      data: {
        agentSessionId: sessionId,
        role: "user",
        content: normalizedMessage,
      },
    });

    return tx.agentSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
  });
}

export async function runAcceptedContinuationSession(
  sessionId: string,
  options: RunPlanningSessionOptions = {}
): Promise<PlanningSessionResult> {
  const session = await prisma.agentSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  try {
    const result = await runWithTimeoutAndRetry({
      timeoutMs: session.timeoutMs || SESSION_TIMEOUT_MS,
      maxAttempts: SESSION_MAX_ATTEMPTS,
      run: async ({ signal }) =>
        runContinuationAttempt(sessionId, signal, options),
    });

    const completed = await prisma.agentSession.update({
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
      tripId: completed.tripId,
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
            content: formatPlanningFailureMessage(error),
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

async function runContinuationAttempt(
  sessionId: string,
  signal?: AbortSignal,
  options: RunPlanningSessionOptions = {}
): Promise<{ tripId: string | null; summary: string }> {
  assertAgentRunActive(signal);
  const session = await prisma.agentSession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  const settings = await loadPlanningSettings(session.userId);
  const chatClient = options.chatClient ?? createOpenAiChatClient();
  const context: ToolExecutionContext = {
    amap: options.amapClient ?? createAmapClient(),
    sessionId,
    userId: session.userId,
    prompt: session.prompt,
    tripId: session.tripId,
    signal,
  };
  const messages = await createContinuationMessages(session);
  const result = await runConversationAttempt({
    sessionId,
    context,
    settings,
    messages,
    chatClient,
    signal,
    requireCreateTrip: false,
  });

  return {
    tripId: result.tripId ?? session.tripId,
    summary: result.summary,
  };
}

export async function runPlanningAttempt(
  sessionId: string,
  attempt = 1,
  signal?: AbortSignal,
  options: RunPlanningSessionOptions = {}
): Promise<PlanningAttemptResult> {
  assertAgentRunActive(signal);
  const session = await prisma.agentSession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  const settings = await loadPlanningSettings(session.userId);
  const chatClient = options.chatClient ?? createOpenAiChatClient();
  const context: ToolExecutionContext = {
    amap: options.amapClient ?? createAmapClient(),
    sessionId,
    userId: session.userId,
    prompt: session.prompt,
    signal,
  };
  const messages = await createInitialMessages(session, attempt);

  await createAssistantMessage({
    sessionId,
    signal,
    content: `第 ${attempt} 次规划尝试：AI 可以持续调用工具，直到创建最终行程。`,
  });

  const result = await runConversationAttempt({
    sessionId,
    context,
    settings,
    messages,
    chatClient,
    signal,
    requireCreateTrip: true,
  });

  if (!result.tripId) {
    throw new Error("AI 结束了规划，但没有创建行程。");
  }

  return {
    tripId: result.tripId,
    summary: result.summary,
  };
}
