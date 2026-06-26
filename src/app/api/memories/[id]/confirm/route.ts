import { prisma } from "@/lib/db";
import { apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";
import { serializeMemory } from "@/lib/trips/serialize";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withAuth(async () => {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const memory = await prisma.memory.update({
      where: { id },
      data: {
        status: "confirmed",
        label: body.label,
        valueJson: body.value ? JSON.stringify(body.value) : undefined
      }
    });
    return apiOk({ memory: serializeMemory(memory) });
  });
}
