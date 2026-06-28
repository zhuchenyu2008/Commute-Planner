import { prisma } from "@/lib/db";

export async function confirmMemoryCandidate(input: {
  candidateId: string;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.memoryCandidate.findFirst({
      where: { id: input.candidateId, userId: input.userId },
    });

    if (!candidate) {
      throw new Error("未找到记忆候选");
    }

    if (candidate.status !== "pending") {
      throw new Error("记忆候选已处理");
    }

    await tx.memory.create({
      data: {
        userId: candidate.userId,
        kind: candidate.kind,
        label: candidate.label,
        valueJson: candidate.valueJson,
      },
    });

    await tx.memoryCandidate.update({
      where: { id: candidate.id },
      data: { status: "confirmed" },
    });

    return { status: "confirmed" };
  });
}

export async function ignoreMemoryCandidate(input: {
  candidateId: string;
  userId: string;
}) {
  const candidate = await prisma.memoryCandidate.findFirst({
    where: { id: input.candidateId, userId: input.userId },
  });

  if (!candidate) {
    throw new Error("未找到记忆候选");
  }

  if (candidate.status !== "pending") {
    throw new Error("记忆候选已处理");
  }

  await prisma.memoryCandidate.update({
    where: { id: candidate.id },
    data: { status: "ignored" },
  });

  return { status: "ignored" };
}
