import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE = "commute_session";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createUserSession(userId: string) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt
    }
  });

  return { token, expiresAt };
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: {
        include: {
          settings: true
        }
      }
    }
  });

  if (!session || session.expiresAt <= new Date()) {
    return null;
  }

  return session.user;
}
