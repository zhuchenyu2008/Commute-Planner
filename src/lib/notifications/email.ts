import tls from "node:tls";
import nodemailer from "nodemailer";
import type { NotificationSendResult } from "./telegram";

export type EmailSendInput = {
  to?: string | null;
  subject: string;
  text: string;
};

const hasValue = (value: string | undefined | null): value is string =>
  typeof value === "string" && value.trim().length > 0;

function isEnabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function configureSystemCaIfRequested() {
  if (!isEnabled(process.env.SMTP_TLS_USE_SYSTEM_CA)) {
    return;
  }

  if (
    typeof tls.getCACertificates !== "function" ||
    typeof tls.setDefaultCACertificates !== "function"
  ) {
    return;
  }

  const systemCertificates = tls.getCACertificates("system");

  if (systemCertificates.length > 0) {
    tls.setDefaultCACertificates(systemCertificates);
  }
}

function formatEmailError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Email request failed";
  const code =
    error instanceof Error && "code" in error
      ? String(error.code)
      : "";
  const diagnosticText = `${code} ${message}`;

  if (
    /unable to verify the first certificate|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_/i.test(
      diagnosticText
    )
  ) {
    return `SMTP 证书链校验失败：${message}。请检查 SMTP 服务器是否提供完整中间证书链；如果根 CA 已安装在本机，可设置 SMTP_TLS_USE_SYSTEM_CA=true，或用 NODE_OPTIONS=--use-system-ca 启动 Node.js。`;
  }

  return message;
}

export async function sendEmail({
  to,
  subject,
  text,
}: EmailSendInput): Promise<NotificationSendResult> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM ?? user;
  const recipient = to ?? null;

  if (
    !hasValue(host) ||
    !hasValue(user) ||
    !hasValue(pass) ||
    !hasValue(recipient)
  ) {
    const missing = [
      !hasValue(host) ? "SMTP_HOST" : null,
      !hasValue(user) ? "SMTP_USER" : null,
      !hasValue(pass) ? "SMTP_PASS" : null,
      !hasValue(recipient) ? "邮件接收人" : null,
    ].filter(Boolean);

    return {
      status: "skipped",
      recipient,
      error: `缺少 ${missing.join("、")}`,
    };
  }

  const toAddress = recipient.trim();

  try {
    configureSystemCaIfRequested();

    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user, pass },
    });

    await transporter.sendMail({
      from,
      to: toAddress,
      subject,
      text,
    });

    return { status: "sent", recipient };
  } catch (error) {
    return {
      status: "failed",
      recipient,
      error: formatEmailError(error),
    };
  }
}
