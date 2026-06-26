import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";

const COOKIE_NAME = "commute_session";
const encoder = new TextEncoder();

function sessionKey() {
  return encoder.encode(env.sessionSecret);
}

export async function createSession() {
  return new SignJWT({ sub: "single-user" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(sessionKey());
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSessionFromCookies() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  try {
    const verified = await jwtVerify(token, sessionKey());
    return verified.payload.sub === "single-user" ? verified.payload : null;
  } catch {
    return null;
  }
}

export async function requireSession() {
  const session = await getSessionFromCookies();
  if (!session) {
    throw new UnauthorizedError();
  }
  return session;
}

export async function verifyPassword(password: string) {
  const stored = await getPasswordHash();
  return bcrypt.compare(password, stored);
}

export async function setPassword(password: string) {
  const hash = await bcrypt.hash(password, 12);
  await prisma.appSetting.upsert({
    where: { key: "passwordHash" },
    update: { value: hash },
    create: { key: "passwordHash", value: hash }
  });
}

export async function getPasswordHash() {
  const setting = await prisma.appSetting.findUnique({ where: { key: "passwordHash" } });
  if (setting?.value) {
    return setting.value;
  }
  if (env.appPasswordHash) {
    return env.appPasswordHash;
  }
  const hash = await bcrypt.hash(env.appInitialPassword, 12);
  await prisma.appSetting.upsert({
    where: { key: "passwordHash" },
    update: { value: hash },
    create: { key: "passwordHash", value: hash }
  });
  return hash;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("请先登录");
  }
}
