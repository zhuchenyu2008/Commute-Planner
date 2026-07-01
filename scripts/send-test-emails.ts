import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/notifications/email";
import {
  buildTemplateEmailRecipientQuery,
  selectTemplateEmailRecipient,
} from "@/lib/notifications/test-email-recipient";
import { sendTemplateTestEmails } from "@/lib/notifications/test-email-sender";
import { buildTemplateTestEmails } from "@/lib/notifications/test-email-samples";

async function main() {
  const settings = await prisma.userSettings.findMany(
    buildTemplateEmailRecipientQuery()
  );

  const recipient = selectTemplateEmailRecipient(settings);

  if (!recipient) {
    throw new Error("没有找到已配置的邮件接收人 emailRecipient。");
  }

  const emails = buildTemplateTestEmails();

  await sendTemplateTestEmails({
    recipient,
    emails,
    sendEmail,
    log: console.log,
  });
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
