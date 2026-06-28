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

export function createFallbackChatClient(): AgentChatClient {
  return {
    async complete({ messages }) {
      const toolMessages = messages.filter((message) => message.role === "tool");

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

      if (!toolMessages.some((message) => message.toolCallId === "mock-route")) {
        return {
          message: {
            role: "assistant",
            content: "mock agent 查询高德路线候选。",
            toolCalls: [
              {
                id: "mock-route",
                name: "get_transit_route",
                arguments: {
                  origin: originLngLat,
                  destination: "121.616,29.868",
                  city: "宁波",
                  cityd: "宁波",
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
                finalStopName: "宁波龙湖天街",
                stops: [
                  {
                    order: 1,
                    name: "宁波龙湖天街",
                    address: "浙江省宁波市龙湖天街",
                    lngLat: "121.616,29.868",
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
                    routeMinutes: 42,
                    bufferMinutes: 10,
                    totalMinutes: 52,
                    mode: "transit",
                    routeTitle: "公交/地铁路线：家 到 宁波龙湖天街",
                    routeRationale:
                      "mock agent 根据高德路线工具结果选择公交/地铁作为本地演示方案。",
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
                        reason: "天气只作为 mock agent 的参考信息。",
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
