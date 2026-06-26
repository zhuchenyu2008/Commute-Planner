import { prisma } from "@/lib/db";
import { apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";
import { serializeMemory } from "@/lib/trips/serialize";

export async function GET(request: Request) {
  return withAuth(async () => {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") || undefined;
    const status = url.searchParams.get("status")?.split(",").filter(Boolean);
    const memories = await prisma.memory.findMany({
      where: {
        type,
        status: status?.length ? { in: status } : undefined,
        deletedAt: null
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }]
    });
    return apiOk({ memories: memories.map(serializeMemory) });
  });
}

export async function POST(request: Request) {
  return withAuth(async () => {
    const body = await request.json();
    const memory = await prisma.memory.create({
      data: {
        type: String(body.type || "general_note"),
        status: String(body.status || "confirmed"),
        label: String(body.label || "未命名"),
        valueJson: JSON.stringify(body.value || {}),
        sourceText: body.sourceText,
        confidence: typeof body.confidence === "number" ? body.confidence : undefined
      }
    });
    return apiOk({ memory: serializeMemory(memory) });
  });
}
