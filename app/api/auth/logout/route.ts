import { NextResponse } from "next/server";
import { SESSION_COOKIE, hashSessionToken } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  let decodedToken: string | null = null;
  if (token) {
    try {
      decodedToken = decodeURIComponent(token);
    } catch {
      decodedToken = null;
    }
  }

  if (decodedToken) {
    await prisma.session.deleteMany({
      where: { tokenHash: hashSessionToken(decodedToken) }
    });
  }

  const response = NextResponse.json({ ok: true });

  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });

  return response;
}
