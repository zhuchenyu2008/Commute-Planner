import type { Prisma } from "@prisma/client";

export function buildTemplateEmailRecipientQuery() {
  return {
    where: {
      emailRecipient: { not: null },
    },
    orderBy: { updatedAt: "desc" },
  } satisfies Prisma.UserSettingsFindManyArgs;
}

export function selectTemplateEmailRecipient(
  settings: Array<{ emailRecipient: string | null }>
): string | null {
  for (const setting of settings) {
    const recipient = setting.emailRecipient?.trim();

    if (recipient) {
      return recipient;
    }
  }

  return null;
}
