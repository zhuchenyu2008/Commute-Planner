import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth/password";
import {
  SESSION_COOKIE,
  createUserSession
} from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
  }

  const session = await createUserSession(user.id);
  const response = NextResponse.json({ ok: true });

  response.cookies.set({
    name: SESSION_COOKIE,
    value: session.token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt
  });

  return response;
}
