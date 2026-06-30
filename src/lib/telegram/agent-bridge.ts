import {
  acceptAgentSessionMessage,
  runAcceptedContinuationSession,
  runPlanningSession,
  startPlanningSession,
} from "@/lib/agent/planner";
import { prisma } from "@/lib/db";

export type TelegramAgentBridge = {
  startPlanning(input: { userId: string; prompt: string }): Promise<{
    sessionId: string;
    tripId: string | null;
    summary: string;
  }>;
  continueSession(input: {
    userId: string;
    sessionId: string;
    message: string;
  }): Promise<{ sessionId: string; tripId: string | null; summary: string }>;
};

async function getLatestAssistantSummary(agentSessionId: string) {
  const message = await prisma.agentMessage.findFirst({
    where: { agentSessionId, role: "assistant" },
    orderBy: { createdAt: "desc" },
  });

  return message?.content ?? "智能体处理完成。";
}

export function createTelegramAgentBridge(): TelegramAgentBridge {
  return {
    async startPlanning({ userId, prompt }) {
      const session = await startPlanningSession({ userId, prompt });
      const result = await runPlanningSession(session.id);
      const summary = await getLatestAssistantSummary(session.id);

      return {
        sessionId: session.id,
        tripId: result.tripId ?? null,
        summary,
      };
    },
    async continueSession({ userId, sessionId, message }) {
      const session = await acceptAgentSessionMessage({
        userId,
        sessionId,
        message,
      });
      const result = await runAcceptedContinuationSession(session.id);
      const summary = await getLatestAssistantSummary(session.id);

      return {
        sessionId: session.id,
        tripId: result.tripId ?? null,
        summary,
      };
    },
  };
}
