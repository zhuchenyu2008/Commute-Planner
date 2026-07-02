import OpenAI from "openai";

export type AgentChatRole = "system" | "user" | "assistant" | "tool";

export type AgentChatToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AgentChatMessage = {
  role: AgentChatRole;
  content: string;
  toolCallId?: string;
  toolCalls?: AgentChatToolCall[];
};

export type AgentChatToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AgentChatCompletionInput = {
  messages: AgentChatMessage[];
  tools: AgentChatToolDefinition[];
  signal?: AbortSignal;
};

export type AgentChatCompletion = {
  message: AgentChatMessage;
};

export type AgentChatClient = {
  complete(input: AgentChatCompletionInput): Promise<AgentChatCompletion>;
};

type EnvSource = Partial<Record<string, string | undefined>>;

const DEFAULT_MODEL = "gpt-4o-mini";

function parseToolArguments(value: string | null | undefined) {
  if (!value) return {};

  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function toOpenAiMessages(messages: AgentChatMessage[]) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool" as const,
        content: message.content,
        tool_call_id: message.toolCallId ?? "",
      };
    }

    if (message.role === "assistant") {
      return {
        role: "assistant" as const,
        content: message.content,
        tool_calls: message.toolCalls?.map((toolCall) => ({
          id: toolCall.id,
          type: "function" as const,
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        })),
      };
    }

    return {
      role: message.role,
      content: message.content,
    };
  });
}

export function createOpenAiChatClient(
  env: EnvSource = process.env
): AgentChatClient {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return createFallbackChatClient();
  }

  const client = new OpenAI({
    apiKey,
    baseURL: env.OPENAI_BASE_URL?.trim() || undefined,
  });
  const model = env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;

  return {
    async complete(input) {
      const completion = await client.chat.completions.create(
        {
          model,
          messages: toOpenAiMessages(input.messages),
          tools: input.tools.map((tool) => ({
            type: "function" as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          tool_choice: "auto",
        },
        { signal: input.signal }
      );

      const message = completion.choices[0]?.message;

      if (!message) {
        throw new Error("OpenAI 未返回规划消息。");
      }

      return {
        message: {
          role: "assistant",
          content: message.content ?? "",
          toolCalls: message.tool_calls?.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: parseToolArguments(toolCall.function.arguments),
          })),
        },
      };
    },
  };
}

function getFallbackUserMessage(messages: AgentChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user")
    ?.content;
}

function toFallbackBeijingIso(input: {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
}) {
  const { day, hour, minute, month, year } = input;

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return undefined;
  }

  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute)).toISOString();
}

function extractFallbackTargetArriveAts(messages: AgentChatMessage[]) {
  const userMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.content;
  const dateMatch = userMessage?.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);

  if (!userMessage || !dateMatch) return [];

  const [, rawYear, rawMonth, rawDay] = dateMatch;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);

  return [...userMessage.matchAll(/\b(\d{1,2}):(\d{2})\b/g)]
    .map((match) =>
      toFallbackBeijingIso({
        day,
        hour: Number(match[1]),
        minute: Number(match[2]),
        month,
        year,
      })
    )
    .filter((value): value is string => Boolean(value));
}

function extractFallbackTargetArriveAt(messages: AgentChatMessage[]) {
  return extractFallbackTargetArriveAts(messages).at(-1);
}

function extractFallbackContextTargetArriveAt(messages: AgentChatMessage[]) {
  const values: string[] = [];

  for (const message of messages) {
    if (message.role !== "user" && message.role !== "system") continue;

    const dateMatch = message.content.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (!dateMatch) continue;

    const [, rawYear, rawMonth, rawDay] = dateMatch;
    const year = Number(rawYear);
    const month = Number(rawMonth);
    const day = Number(rawDay);

    for (const match of message.content.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
      const value = toFallbackBeijingIso({
        day,
        hour: Number(match[1]),
        minute: Number(match[2]),
        month,
        year,
      });

      if (value) values.push(value);
    }
  }

  return values.at(-1);
}

function isFallbackSchoolOfficePrompt(messages: AgentChatMessage[]) {
  const userMessage = getFallbackUserMessage(messages)?.toLowerCase() ?? "";

  return (
    userMessage.includes("foreign affairs school") &&
    userMessage.includes("office")
  );
}

function isFallbackCoffeeLonghuPrompt(messages: AgentChatMessage[]) {
  const userMessage = getFallbackUserMessage(messages)?.toLowerCase() ?? "";

  const mentionsCoffee =
    userMessage.includes("coffee") || userMessage.includes("咖啡");
  const mentionsLonghu =
    userMessage.includes("longhu") || userMessage.includes("龙湖");

  return mentionsCoffee && mentionsLonghu;
}

function isFallbackAddStopPrompt(messages: AgentChatMessage[]) {
  const userMessage = getFallbackUserMessage(messages)?.toLowerCase() ?? "";
  const mentionsCoffee =
    userMessage.includes("coffee") || userMessage.includes("咖啡");
  const mentionsAddStop =
    userMessage.includes("add") ||
    userMessage.includes("stop") ||
    userMessage.includes("中途") ||
    userMessage.includes("加");

  return mentionsCoffee && mentionsAddStop;
}

function getFallbackStopStayMinutes(
  messages: AgentChatMessage[],
  fallbackMinutes: number
) {
  const userMessage = getFallbackUserMessage(messages) ?? "";
  const match = userMessage.match(/(\d+)\s*(?:minutes?|mins?|min|分钟|分)/i);
  const minutes = match ? Number(match[1]) : fallbackMinutes;

  return Number.isFinite(minutes) && minutes > 0 ? minutes : fallbackMinutes;
}

function getFallbackCurrentTripId(messages: AgentChatMessage[]) {
  const currentTripMessage = [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "system" &&
        message.content.includes("Current trip id:")
    )?.content;
  const match = currentTripMessage?.match(/Current trip id:\s*([^.]+)\./);
  const tripId = match?.[1]?.trim();

  return tripId && tripId !== "none" ? tripId : undefined;
}

function getFallbackRelativeArrivalDeltaMinutes(messages: AgentChatMessage[]) {
  const userMessage = getFallbackUserMessage(messages)?.toLowerCase() ?? "";
  const match = userMessage.match(/(\d+)\s*(?:minutes?|mins?|min|鍒嗛挓|鍒?)/);

  if (!match) return undefined;

  const minutes = Number(match[1]);
  if (!Number.isFinite(minutes)) return undefined;

  if (
    userMessage.includes("earlier") ||
    userMessage.includes("鎻愬墠") ||
    userMessage.includes("鎻愭棭")
  ) {
    return -minutes;
  }

  if (
    userMessage.includes("later") ||
    userMessage.includes("delay") ||
    userMessage.includes("postpone") ||
    userMessage.includes("鎺ㄨ繜") ||
    userMessage.includes("寤跺悗") ||
    userMessage.includes("鏅?")
  ) {
    return minutes;
  }

  return undefined;
}

function offsetFallbackIso(iso: string | undefined, deltaMinutes: number) {
  if (!iso) return undefined;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;

  return new Date(date.getTime() + deltaMinutes * 60_000).toISOString();
}

function extractFallbackCurrentTripTargetArriveAt(
  toolMessages: AgentChatMessage[]
) {
  const currentTripMessage = toolMessages.find(
    (message) => message.toolCallId === "mock-read-current-trip"
  );

  if (!currentTripMessage) return undefined;

  const trip = JSON.parse(currentTripMessage.content) as {
    targetArriveAt?: string | null;
    legs?: Array<{ targetArriveAt?: string | null }>;
  };

  return (
    trip.targetArriveAt ??
    [...(trip.legs ?? [])]
      .reverse()
      .find((leg) => Boolean(leg.targetArriveAt))?.targetArriveAt ??
    undefined
  );
}

type FallbackTravelMode = "transit" | "walking" | "bicycling";

type FallbackDestination = {
  address: string;
  lngLat: string;
  name: string;
};

function getFallbackDestination(messages: AgentChatMessage[]): FallbackDestination {
  const userMessage = getFallbackUserMessage(messages)?.toLowerCase() ?? "";

  if (userMessage.includes("foreign affairs school")) {
    return {
      address: "Foreign Affairs School",
      lngLat: "121.560,29.860",
      name: "Foreign Affairs School",
    };
  }

  return {
    address: "Longhu Tianjie",
    lngLat: "121.616,29.868",
    name: "Longhu Tianjie",
  };
}

function getFallbackTravelMode(messages: AgentChatMessage[]): FallbackTravelMode {
  const userMessage = getFallbackUserMessage(messages)?.toLowerCase() ?? "";

  if (
    userMessage.includes("bicycling") ||
    userMessage.includes("cycling") ||
    userMessage.includes("bike") ||
    userMessage.includes("楠戣")
  ) {
    return "bicycling";
  }

  if (userMessage.includes("walking") || userMessage.includes("walk")) {
    return "walking";
  }

  return "transit";
}

function getFallbackRouteToolName(mode: FallbackTravelMode) {
  if (mode === "bicycling") return "get_bicycling_route";
  if (mode === "walking") return "get_walking_route";
  return "get_transit_route";
}

function getFallbackRouteMinutes(mode: FallbackTravelMode) {
  if (mode === "bicycling") return 34;
  if (mode === "walking") return 58;
  return 42;
}

function getFallbackBufferMinutes(mode: FallbackTravelMode) {
  if (mode === "bicycling") return 8;
  if (mode === "walking") return 12;
  return 10;
}

function getFallbackRouteTitle(
  mode: FallbackTravelMode,
  destinationName = "Longhu Tianjie"
) {
  if (mode === "bicycling") return `Bicycling to ${destinationName}`;
  if (mode === "walking") return `Walking to ${destinationName}`;
  return `Transit to ${destinationName}`;
}

function getFallbackRouteRationale(mode: FallbackTravelMode) {
  if (mode === "bicycling") {
    return "mock agent switches to bicycling because the user requested bicycling if weather allows.";
  }

  if (mode === "walking") {
    return "mock agent switches to walking because the user requested a walking route.";
  }

  return "mock agent selects transit as the balanced default route.";
}

export function createFallbackChatClient(): AgentChatClient {
  return {
    async complete({ messages }) {
      const toolMessages = messages.filter((message) => message.role === "tool");
      const currentTripId = getFallbackCurrentTripId(messages);

      if (toolMessages.length === 0) {
        return {
          message: {
            role: "assistant",
            content:
              "mock agent 读取设置、记忆、地点和天气。天气仅作为参考信息，不由应用层写死路线排序。",
            toolCalls: [
              {
                id: "mock-read-settings",
                name: "read_settings",
                arguments: {},
              },
              {
                id: "mock-read-memories",
                name: "read_memories",
                arguments: {},
              },
              {
                id: "mock-search-poi",
                name: "search_poi",
                arguments: { keywords: "龙湖天街", city: "宁波" },
              },
              {
                id: "mock-weather",
                name: "get_weather_reference",
                arguments: { city: "宁波" },
              },
            ],
          },
        };
      }

      const settingsMessage = toolMessages.find(
        (message) => message.toolCallId === "mock-read-settings"
      );
      const settings = settingsMessage
        ? (JSON.parse(settingsMessage.content) as Record<string, unknown>)
        : {};
      const originName =
        typeof settings.originName === "string" ? settings.originName : "";
      const originLngLat =
        typeof settings.originLngLat === "string"
          ? settings.originLngLat
          : "";
      const routeTitle = originName
        ? `公交/地铁路线：${originName} 到 宁波龙湖天街`
        : "公交/地铁路线：前往宁波龙湖天街";

      const destination = getFallbackDestination(messages);
      const travelMode = getFallbackTravelMode(messages);
      const routeMinutes = getFallbackRouteMinutes(travelMode);
      const bufferMinutes = getFallbackBufferMinutes(travelMode);
      const totalMinutes = routeMinutes + bufferMinutes;
      const fallbackRouteTitle = getFallbackRouteTitle(
        travelMode,
        destination.name
      );
      const fallbackRouteRationale = getFallbackRouteRationale(travelMode);

      const targetArriveAts = extractFallbackTargetArriveAts(messages);
      const explicitTargetArriveAt = targetArriveAts.at(-1);
      const relativeDeltaMinutes =
        getFallbackRelativeArrivalDeltaMinutes(messages);
      const contextTargetArriveAt =
        extractFallbackCurrentTripTargetArriveAt(toolMessages) ??
        extractFallbackContextTargetArriveAt(messages);
      const targetArriveAt =
        explicitTargetArriveAt ??
        (relativeDeltaMinutes === undefined
          ? undefined
          : offsetFallbackIso(contextTargetArriveAt, relativeDeltaMinutes));
      const firstStopArriveAt = targetArriveAts[0] ?? targetArriveAt;
      const isSchoolOfficeTrip = isFallbackSchoolOfficePrompt(messages);
      const isCoffeeLonghuTrip = isFallbackCoffeeLonghuPrompt(messages);

      if (!toolMessages.some((message) => message.toolCallId === "mock-route")) {
        return {
          message: {
            role: "assistant",
            content: "mock agent 查询高德路线候选。",
            toolCalls: [
              {
                id: "mock-route",
                name: getFallbackRouteToolName(travelMode),
                arguments: {
                  origin: originLngLat,
                  destination: destination.lngLat,
                  city: "宁波",
                  cityd: "宁波",
                },
              },
            ],
          },
        };
      }

      if (
        toolMessages.some((message) =>
          ["mock-create-trip", "mock-replace-trip"].includes(
            message.toolCallId ?? ""
          )
        )
      ) {
        return {
          message: {
            role: "assistant",
            content: "mock agent 已完成本地演示行程更新。",
          },
        };
      }

      if (isSchoolOfficeTrip) {
        return {
          message: {
            role: "assistant",
            content: "mock agent 创建多段本地演示行程。",
            toolCalls: [
              {
                id: "mock-create-trip",
                name: "create_trip",
                arguments: {
                  title: "E2E Origin-Foreign Affairs School-Office",
                  timezone: "Asia/Shanghai",
                  targetArriveAt,
                  finalStopName: "Office",
                  stops: [
                    {
                      order: 1,
                      name: "Foreign Affairs School",
                      address: "Foreign Affairs School",
                      lngLat: "121.560,29.860",
                      targetArriveAt: firstStopArriveAt,
                      plannedStayMin: 10,
                      kind: "stopover",
                    },
                    {
                      order: 2,
                      name: "Office",
                      address: "Office",
                      lngLat: "121.600,29.880",
                      targetArriveAt,
                      kind: "destination",
                    },
                  ],
                  legs: [
                    {
                      order: 1,
                      originName,
                      originLngLat,
                      destinationName: "Foreign Affairs School",
                      destinationLngLat: "121.560,29.860",
                      targetArriveAt: firstStopArriveAt,
                      routeMinutes: 24,
                      bufferMinutes: 8,
                      totalMinutes: 32,
                      mode: "transit",
                      routeTitle: "E2E Origin to Foreign Affairs School",
                      routeRationale:
                        "mock agent plans the first school drop-off leg before the final office commute.",
                      segmentTitle: "Transit to Foreign Affairs School",
                      segmentDetail:
                        "mock agent generated the first leg from the configured origin to school.",
                      segmentSource: "amap",
                      source: { source: "mock-agent" },
                      bufferComponents: [
                        {
                          category: "transfer",
                          label: "School arrival buffer",
                          minutes: 5,
                          reason: "Reserve time to enter the school area.",
                          source: "agent_inference",
                        },
                        {
                          category: "venue",
                          label: "Drop-off buffer",
                          minutes: 3,
                          reason: "Reserve time for the stopover handoff.",
                          source: "agent_inference",
                        },
                      ],
                    },
                    {
                      order: 2,
                      originName: "Foreign Affairs School",
                      originLngLat: "121.560,29.860",
                      destinationName: "Office",
                      destinationLngLat: "121.600,29.880",
                      targetArriveAt,
                      routeMinutes: 30,
                      bufferMinutes: 10,
                      totalMinutes: 40,
                      mode: "transit",
                      routeTitle: "Foreign Affairs School to Office",
                      routeRationale:
                        "mock agent plans the second leg after the 10 minute school stopover.",
                      segmentTitle: "Transit to Office",
                      segmentDetail:
                        "mock agent generated the second leg from school to office.",
                      segmentSource: "amap",
                      source: { source: "mock-agent" },
                      bufferComponents: [
                        {
                          category: "transfer",
                          label: "Transfer buffer",
                          minutes: 5,
                          reason: "Reserve time for platform and walking friction.",
                          source: "agent_inference",
                        },
                        {
                          category: "venue",
                          label: "Office arrival buffer",
                          minutes: 5,
                          reason: "Reserve time to enter the workplace.",
                          source: "agent_inference",
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        };
      }

      if (isCoffeeLonghuTrip) {
        return {
          message: {
            role: "assistant",
            content: "mock agent 创建带停靠点的本地演示行程。",
            toolCalls: [
              {
                id: "mock-create-trip",
                name: "create_trip",
                arguments: {
                  title: "E2E Origin-Coffee Shop Near Station-Longhu Tianjie",
                  timezone: "Asia/Shanghai",
                  targetArriveAt,
                  finalStopName: "Longhu Tianjie",
                  stops: [
                    {
                      order: 1,
                      name: "Coffee Shop Near Station",
                      address: "Coffee Shop Near Station",
                      lngLat: "121.550,29.865",
                      targetArriveAt: firstStopArriveAt,
                      plannedStayMin: 8,
                      kind: "stopover",
                    },
                    {
                      order: 2,
                      name: "Longhu Tianjie",
                      address: "Longhu Tianjie",
                      lngLat: "121.616,29.868",
                      targetArriveAt,
                      kind: "destination",
                    },
                  ],
                  legs: [
                    {
                      order: 1,
                      originName,
                      originLngLat,
                      destinationName: "Coffee Shop Near Station",
                      destinationLngLat: "121.550,29.865",
                      targetArriveAt: firstStopArriveAt,
                      routeMinutes: 18,
                      bufferMinutes: 7,
                      totalMinutes: 25,
                      mode: "transit",
                      routeTitle: "E2E Origin to Coffee Shop Near Station",
                      routeRationale:
                        "mock agent plans the errand stop before continuing to Longhu Tianjie.",
                      segmentTitle: "Transit to Coffee Shop Near Station",
                      segmentDetail:
                        "mock agent generated the first leg from origin to the coffee stop.",
                      segmentSource: "amap",
                      source: { source: "mock-agent" },
                      bufferComponents: [
                        {
                          category: "transfer",
                          label: "Coffee stop approach buffer",
                          minutes: 4,
                          reason: "Reserve time to reach the shop from transit.",
                          source: "agent_inference",
                        },
                        {
                          category: "venue",
                          label: "Ordering buffer",
                          minutes: 3,
                          reason: "Reserve time for the coffee purchase.",
                          source: "agent_inference",
                        },
                      ],
                    },
                    {
                      order: 2,
                      originName: "Coffee Shop Near Station",
                      originLngLat: "121.550,29.865",
                      destinationName: "Longhu Tianjie",
                      destinationLngLat: "121.616,29.868",
                      targetArriveAt,
                      routeMinutes: 26,
                      bufferMinutes: 10,
                      totalMinutes: 36,
                      mode: "transit",
                      routeTitle: "Coffee Shop Near Station to Longhu Tianjie",
                      routeRationale:
                        "mock agent continues from the 8 minute errand stop to the final destination.",
                      segmentTitle: "Transit to Longhu Tianjie",
                      segmentDetail:
                        "mock agent generated the second leg from the coffee stop to Longhu Tianjie.",
                      segmentSource: "amap",
                      source: { source: "mock-agent" },
                      bufferComponents: [
                        {
                          category: "transfer",
                          label: "Transfer buffer",
                          minutes: Math.max(0, bufferMinutes - 5),
                          reason: "Reserve time for transit and walking friction.",
                          source: "agent_inference",
                        },
                        {
                          category: "venue",
                          label: "Arrival buffer",
                          minutes: 5,
                          reason: "Reserve time to enter Longhu Tianjie.",
                          source: "agent_inference",
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        };
      }

      if (currentTripId && isFallbackAddStopPrompt(messages)) {
        const stayMinutes = getFallbackStopStayMinutes(messages, 5);
        const coffeeStopArriveAt =
          offsetFallbackIso(targetArriveAt, -(36 + stayMinutes)) ??
          targetArriveAt;

        return {
          message: {
            role: "assistant",
            content: "mock agent adds a coffee stop to the current local demo trip.",
            toolCalls: [
              {
                id: "mock-replace-trip",
                name: "replace_trip_legs",
                arguments: {
                  tripId: currentTripId,
                  title: "E2E Origin-Coffee Shop Near Station-Longhu Tianjie",
                  targetArriveAt,
                  finalStopName: "Longhu Tianjie",
                  stops: [
                    {
                      order: 1,
                      name: "Coffee Shop Near Station",
                      address: "Coffee Shop Near Station",
                      lngLat: "121.550,29.865",
                      targetArriveAt: coffeeStopArriveAt,
                      plannedStayMin: stayMinutes,
                      kind: "stopover",
                    },
                    {
                      order: 2,
                      name: "Longhu Tianjie",
                      address: "Longhu Tianjie",
                      lngLat: "121.616,29.868",
                      targetArriveAt,
                      kind: "destination",
                    },
                  ],
                  legs: [
                    {
                      order: 1,
                      originName,
                      originLngLat,
                      destinationName: "Coffee Shop Near Station",
                      destinationLngLat: "121.550,29.865",
                      targetArriveAt: coffeeStopArriveAt,
                      routeMinutes: 18,
                      bufferMinutes: 7,
                      totalMinutes: 25,
                      mode: "transit",
                      routeTitle: "E2E Origin to Coffee Shop Near Station",
                      routeRationale:
                        "mock agent adds the requested coffee stop before continuing to Longhu Tianjie.",
                      segmentTitle: "Transit to Coffee Shop Near Station",
                      segmentDetail:
                        "mock agent generated the first leg from origin to the coffee stop.",
                      segmentSource: "amap",
                      source: { source: "mock-agent" },
                      bufferComponents: [
                        {
                          category: "transfer",
                          label: "Coffee stop approach buffer",
                          minutes: 4,
                          reason: "Reserve time to reach the shop from transit.",
                          source: "agent_inference",
                        },
                        {
                          category: "venue",
                          label: "Ordering buffer",
                          minutes: 3,
                          reason: "Reserve time for the coffee purchase.",
                          source: "agent_inference",
                        },
                      ],
                    },
                    {
                      order: 2,
                      originName: "Coffee Shop Near Station",
                      originLngLat: "121.550,29.865",
                      destinationName: "Longhu Tianjie",
                      destinationLngLat: "121.616,29.868",
                      targetArriveAt,
                      routeMinutes: 26,
                      bufferMinutes: 10,
                      totalMinutes: 36,
                      mode: "transit",
                      routeTitle: "Coffee Shop Near Station to Longhu Tianjie",
                      routeRationale:
                        "mock agent continues from the requested coffee stop to the final destination.",
                      segmentTitle: "Transit to Longhu Tianjie",
                      segmentDetail:
                        "mock agent generated the second leg from the coffee stop to Longhu Tianjie.",
                      segmentSource: "amap",
                      source: { source: "mock-agent" },
                      bufferComponents: [
                        {
                          category: "transfer",
                          label: "Transfer buffer",
                          minutes: Math.max(0, bufferMinutes - 5),
                          reason: "Reserve time for transit and walking friction.",
                          source: "agent_inference",
                        },
                        {
                          category: "venue",
                          label: "Arrival buffer",
                          minutes: 5,
                          reason: "Reserve time to enter Longhu Tianjie.",
                          source: "agent_inference",
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        };
      }

      if (currentTripId) {
        return {
          message: {
            role: "assistant",
            content: "mock agent updates the current local demo trip.",
            toolCalls: [
              {
                id: "mock-replace-trip",
                name: "replace_trip_legs",
                arguments: {
                  tripId: currentTripId,
                  title: destination.name,
                  targetArriveAt,
                  finalStopName: destination.name,
                  stops: [
                    {
                      order: 1,
                      name: destination.name,
                      address: destination.address,
                      lngLat: destination.lngLat,
                      targetArriveAt,
                      kind: "destination",
                    },
                  ],
                  legs: [
                    {
                      order: 1,
                      originName,
                      originLngLat,
                      destinationName: destination.name,
                      destinationLngLat: destination.lngLat,
                      targetArriveAt,
                      routeMinutes,
                      bufferMinutes,
                      totalMinutes,
                      mode: travelMode,
                      routeTitle: fallbackRouteTitle,
                      routeRationale: fallbackRouteRationale,
                      segmentTitle: fallbackRouteTitle,
                      segmentDetail:
                        "mock agent replaced the current route instead of creating a duplicate trip.",
                      segmentSource: "amap",
                      source: { source: "mock-agent" },
                      bufferComponents: [
                        {
                          category: "venue",
                          label: "Arrival buffer",
                          minutes: 5,
                          reason: "Reserve time to enter Longhu Tianjie.",
                          source: "agent_inference",
                        },
                        {
                          category: "transfer",
                          label: "Transfer buffer",
                          minutes: 5,
                          reason: "Reserve time for transit and walking friction.",
                          source: "agent_inference",
                        },
                        {
                          category: "weather_context",
                          label: "Weather reference",
                          minutes: 0,
                          reason:
                            "Weather is reference context for this deterministic fallback route.",
                          source: "weather_context",
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        };
      }

      return {
        message: {
          role: "assistant",
          content: "mock agent 创建本地演示行程。",
          toolCalls: [
            {
              id: "mock-create-trip",
              name: "create_trip",
              arguments: {
                title: "宁波龙湖天街",
                timezone: "Asia/Shanghai",
                targetArriveAt,
                finalStopName: "宁波龙湖天街",
                stops: [
                  {
                    order: 1,
                    name: "宁波龙湖天街",
                    address: "浙江省宁波市龙湖天街",
                    lngLat: "121.616,29.868",
                    targetArriveAt,
                    kind: "destination",
                  },
                ],
                legs: [
                  {
                    order: 1,
                    originName,
                    originLngLat,
                    destinationName: "宁波龙湖天街",
                    destinationLngLat: "121.616,29.868",
                    targetArriveAt,
                    routeMinutes: 42,
                    bufferMinutes: 10,
                    totalMinutes: 52,
                    mode: "transit",
                    routeTitle,
                    routeRationale:
                      "mock agent 根据高德路线和天气证据选择公交/地铁作为本地演示方案。",
                    segmentTitle: "公交/地铁到龙湖天街",
                    segmentDetail: "mock agent 通过工具调用生成，非固定 planner 排序。",
                    segmentSource: "amap",
                    source: { source: "mock-agent" },
                    bufferComponents: [
                      {
                        category: "venue",
                        label: "到场缓冲",
                        minutes: 5,
                        reason: "mock agent 预留进入商场和找位置时间。",
                        source: "agent_inference",
                      },
                      {
                        category: "transfer",
                        label: "换乘缓冲",
                        minutes: 5,
                        reason: "mock agent 预留站台、接驳和步行摩擦。",
                        source: "agent_inference",
                      },
                      {
                        category: "weather_context",
                        label: "天气参考",
                        minutes: 0,
                        reason: "当前 mock 天气温和，暂不额外增加天气缓冲。",
                        source: "weather_context",
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
}
