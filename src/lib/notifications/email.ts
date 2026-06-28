import nodemailer from "nodemailer";
import type { NotificationSendResult } from "./telegram";

export type EmailSendInput = {
  to?: string | null;
  subject: string;
  text: string;
};

const hasValue = (value: string | undefined | null): value is string =>
  typeof value === "string" && value.trim().length > 0;

export async function sendEmail({
  to,
  subject,
  text,
}: EmailSendInput): Promise<NotificationSendResult> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM ?? user;
  const recipient = to ?? process.env.EMAIL_RECIPIENT ?? null;

  if (
    !hasValue(host) ||
    !hasValue(user) ||
    !hasValue(pass) ||
    !hasValue(recipient)
  ) {
    return { status: "skipped", recipient };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user, pass },
    });

    await transporter.sendMail({
      from,
      to: recipient,
      subject,
      text,
    });

    return { status: "sent", recipient };
  } catch (error) {
    return {
      status: "failed",
      recipient,
      error: error instanceof Error ? error.message : "Email request failed",
    };
  }
}
