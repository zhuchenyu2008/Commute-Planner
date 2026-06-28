import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  runPlanningSession,
  startPlanningSession,
} from "@/lib/agent/planner";

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) {
    return NextResponse.json(
      { error: "prompt is required" },
      { status: 400 }
    );
  }

  const session = await startPlanningSession({
    userId: user.id,
    prompt,
  });

  void runPlanningSession(session.id);

  return NextResponse.json({
    sessionId: session.id,
    status: session.status,
  });
}
