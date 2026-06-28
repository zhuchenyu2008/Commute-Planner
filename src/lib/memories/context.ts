import { prisma } from "@/lib/db";

const MAX_MEMORY_VALUE_LENGTH = 500;

function formatMemoryValue(valueJson: string) {
  if (valueJson.length <= MAX_MEMORY_VALUE_LENGTH) {
    return valueJson;
  }

  return `${valueJson.slice(0, MAX_MEMORY_VALUE_LENGTH)}...`;
}

export async function buildConfirmedMemoryContext(userId: string) {
  const memories = await prisma.memory.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  if (memories.length === 0) {
    return "用户已确认的长期记忆：暂无。";
  }

  const lines = memories.map((memory, index) => {
    return `${index + 1}. [${memory.kind}] ${memory.label}: ${formatMemoryValue(
      memory.valueJson
    )}`;
  });

  return [
    "用户已确认的长期记忆如下。",
    "这些记忆已经由用户确认，后续规划和续聊时应作为长期偏好、常用地点或习惯证据使用。",
    ...lines,
  ].join("\n");
}
