import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSessionToken, hashSessionToken } from "@/lib/auth/session";

describe("local auth helpers", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("password");
    expect(hash).not.toBe("password");
    await expect(verifyPassword("password", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });

  it("creates opaque session tokens and hashes them for storage", () => {
    const token = createSessionToken();
    expect(token.length).toBeGreaterThan(32);
    expect(hashSessionToken(token)).not.toBe(token);
  });
});
