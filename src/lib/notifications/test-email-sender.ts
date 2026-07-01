import type { EmailSendInput } from "@/lib/notifications/email";
import type { TemplateTestEmail } from "@/lib/notifications/test-email-samples";
import type { NotificationSendResult } from "@/lib/notifications/telegram";

export async function sendTemplateTestEmails({
  recipient,
  emails,
  sendEmail,
  log,
}: {
  recipient: string;
  emails: TemplateTestEmail[];
  sendEmail: (input: EmailSendInput) => Promise<NotificationSendResult>;
  log: (message: string) => void;
}) {
  const failed: Array<{
    label: TemplateTestEmail["label"];
    result: NotificationSendResult;
  }> = [];

  for (const email of emails) {
    const result = await sendEmail({
      to: recipient,
      subject: `[测试] ${email.subject}`,
      text: email.text,
      html: email.html,
    });

    log(
      `[${email.label}] ${result.status} -> ${result.recipient ?? recipient}${
        result.error ? ` (${result.error})` : ""
      }`
    );

    if (result.status !== "sent") {
      failed.push({ label: email.label, result });
    }
  }

  if (failed.length > 0) {
    throw new Error(
      failed
        .map(
          ({ label, result }) =>
            `${label}测试邮件未发送成功：${result.error ?? result.status}`
        )
        .join("；")
    );
  }
}
