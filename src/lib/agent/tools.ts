import { prisma } from "@/lib/db";
import type { AgentToolCallStatus, AgentToolName } from "@/lib/agent/types";

type RecordToolCallInput<T> = {
  agentSessionId: string;
  name: AgentToolName;
  request: unknown;
  signal?: AbortSignal;
  run(): Promise<T>;
};

const serialize = (value: unknown) => JSON.stringify(value ?? null);

export function assertAgentRunActive(signal?: AbortSignal) {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;
  throw reason instanceof Error ? reason : new Error("Agent run aborted.");
}

export async function recordToolCall<T>({
  agentSessionId,
  name,
  request,
  signal,
  run,
}: RecordToolCallInput<T>): Promise<T> {
  assertAgentRunActive(signal);
  const startedAt = Date.now();
  const toolCall = await prisma.agentToolCall.create({
    data: {
      agentSessionId,
      name,
      status: "running" satisfies AgentToolCallStatus,
      requestJson: serialize(request),
    },
  });

  try {
    assertAgentRunActive(signal);
    const response = await run();
    assertAgentRunActive(signal);
    await prisma.agentToolCall.update({
      where: { id: toolCall.id },
      data: {
        status: "completed" satisfies AgentToolCallStatus,
        responseJson: serialize(response),
        durationMs: Date.now() - startedAt,
      },
    });

    return response;
  } catch (error) {
    await prisma.agentToolCall.update({
      where: { id: toolCall.id },
      data: {
        status: "failed" satisfies AgentToolCallStatus,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    throw error;
  }
}
