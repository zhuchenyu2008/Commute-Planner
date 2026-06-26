import { hasOpenAIConfig, env } from "@/lib/env";
import { parseArrivalRequest, type ArrivalParseResult } from "@/lib/agent/time-parser";

export async function parseTripMessage(text: string, timezone: string): Promise<ArrivalParseResult> {
  if (!hasOpenAIConfig()) {
    return parseArrivalRequest(text, { timezone });
  }

  try {
    const response = await fetch(new URL("/v1/chat/completions", env.openaiCompatBaseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.openaiCompatApiKey}`
      },
      body: JSON.stringify({
        model: env.openaiCompatModel,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "你把中文出行请求抽取成 JSON。字段: destinationText, arriveByLocal(YYYY-MM-DD HH:mm), timezone。只输出 JSON。"
          },
          { role: "user", content: `timezone=${timezone}\nrequest=${text}` }
        ],
        response_format: { type: "json_object" }
      })
    });
    if (!response.ok) {
      return parseArrivalRequest(text, { timezone });
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content || "{}");
    if (!parsed.destinationText || !parsed.arriveByLocal) {
      return parseArrivalRequest(text, { timezone });
    }
    const fallback = parseArrivalRequest(text, { timezone });
    return {
      rawText: text,
      destinationText: parsed.destinationText,
      arriveByLocal: parsed.arriveByLocal,
      timezone: parsed.timezone || timezone,
      isPast: fallback.isPast
    };
  } catch {
    return parseArrivalRequest(text, { timezone });
  }
}
