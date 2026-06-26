import nodemailer from "nodemailer";
import { env, hasSmtpConfig, hasTelegramConfig } from "@/lib/env";

export type NotificationSendResult = {
  channel: "telegram" | "email";
  status: "sent" | "skipped" | "failed";
  error?: string;
};

export async function sendTelegram(text: string): Promise<NotificationSendResult> {
  if (!hasTelegramConfig()) {
    return { channel: "telegram", status: "skipped", error: "Telegram 未配置" };
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: env.telegramChatId,
        text
      })
    });
    if (!response.ok) {
      return { channel: "telegram", status: "failed", error: await response.text() };
    }
    return { channel: "telegram", status: "sent" };
  } catch (error) {
    return { channel: "telegram", status: "failed", error: String(error) };
  }
}

export async function sendEmail(subject: string, text: string): Promise<NotificationSendResult> {
  if (!hasSmtpConfig()) {
    return { channel: "email", status: "skipped", error: "SMTP 未配置" };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: {
        user: env.smtpUser,
        pass: env.smtpPass
      }
    });
    await transporter.sendMail({
      from: env.smtpFrom,
      to: env.recipientEmail,
      subject,
      text
    });
    return { channel: "email", status: "sent" };
  } catch (error) {
    return { channel: "email", status: "failed", error: String(error) };
  }
}
