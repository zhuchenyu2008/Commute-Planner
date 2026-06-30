import tls from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/notifications/email";

const { createTransportMock, sendMailMock } = vi.hoisted(() => {
  return {
    createTransportMock: vi.fn(),
    sendMailMock: vi.fn(),
  };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: createTransportMock,
  },
}));

const SMTP_ENV_KEYS = [
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_PASSWORD",
  "SMTP_FROM",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_TLS_USE_SYSTEM_CA",
];

function setCompleteSmtpEnv() {
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_USER = "sender@example.com";
  process.env.SMTP_PASS = "secret";
}

describe("email notifications", () => {
  afterEach(() => {
    for (const key of SMTP_ENV_KEYS) {
      delete process.env[key];
    }

    vi.restoreAllMocks();
    createTransportMock.mockReset();
    sendMailMock.mockReset();
  });

  it("loads system CA certificates when SMTP_TLS_USE_SYSTEM_CA is enabled", async () => {
    setCompleteSmtpEnv();
    process.env.SMTP_TLS_USE_SYSTEM_CA = "true";
    const systemCertificates = ["system-ca"];
    const getCertificates = vi
      .spyOn(tls, "getCACertificates")
      .mockReturnValue(systemCertificates);
    const setCertificates = vi
      .spyOn(tls, "setDefaultCACertificates")
      .mockImplementation(() => undefined);
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });
    sendMailMock.mockResolvedValue({});

    await sendEmail({
      to: "receiver@example.com",
      subject: "Test",
      text: "Body",
    });

    expect(getCertificates).toHaveBeenCalledWith("system");
    expect(setCertificates).toHaveBeenCalledWith(systemCertificates);
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        auth: {
          user: "sender@example.com",
          pass: "secret",
        },
      })
    );
  });

  it("returns an actionable certificate diagnostic for Node TLS chain errors", async () => {
    setCompleteSmtpEnv();
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });
    sendMailMock.mockRejectedValue(
      new Error("unable to verify the first certificate")
    );

    const result = await sendEmail({
      to: "receiver@example.com",
      subject: "Test",
      text: "Body",
    });

    expect(result).toMatchObject({
      status: "failed",
      recipient: "receiver@example.com",
    });
    expect(result.error).toContain("SMTP 证书链校验失败");
    expect(result.error).toContain("--use-system-ca");
  });
});
