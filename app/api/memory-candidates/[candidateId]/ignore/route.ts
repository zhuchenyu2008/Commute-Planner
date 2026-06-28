import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  ignoreMemoryCandidate,
  MemoryCandidateAlreadyHandledError,
  MemoryCandidateNotFoundError,
} from "@/lib/memories/actions";

type RouteContext = {
  params: Promise<{ candidateId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { candidateId } = await context.params;

  try {
    const result = await ignoreMemoryCandidate({ candidateId, userId: user.id });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MemoryCandidateNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    if (error instanceof MemoryCandidateAlreadyHandledError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return NextResponse.json(
      { error: "忽略记忆失败" },
      { status: 500 }
    );
  }
}
