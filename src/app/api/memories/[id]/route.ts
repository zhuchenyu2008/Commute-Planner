import { prisma } from "@/lib/db";
import { apiError, apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";
import { serializeMemory } from "@/lib/trips/serialize";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withAuth(async () => {
    const { id } = await context.params;
    const body = await request.json();
    const memory = await prisma.memory.update({
      where: { id },
      data: {
        type: body.type,
        status: body.status,
        label: body.label,
        valueJson: body.value ? JSON.stringify(body.value) : undefined,
        sourceText: body.sourceText,
        confidence: body.confidence
      }
    });
    return apiOk({ memory: serializeMemory(memory) });
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return withAuth(async () => {
    const { id } = await context.params;
    const existing = await prisma.memory.findUnique({ where: { id } });
    if (!existing) {
      return apiError("NOT_FOUND", "记忆不存在", 404);
    }
    await prisma.memory.update({
      where: { id },
      data: { status: "deleted", deletedAt: new Date() }
    });
    return apiOk({ ok: true });
  });
}
