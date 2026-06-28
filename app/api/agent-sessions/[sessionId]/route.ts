import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const session = await prisma.agentSession.findFirst({
    where: {
      id: sessionId,
      userId: user.id,
    },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      toolCalls: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    session: {
      id: session.id,
      userId: session.userId,
      tripId: session.tripId,
      status: session.status,
      purpose: session.purpose,
      prompt: session.prompt,
      retryCount: session.retryCount,
      timeoutMs: session.timeoutMs,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: session.messages,
      toolCalls: session.toolCalls,
    },
  });
}
