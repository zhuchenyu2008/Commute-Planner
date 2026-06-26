import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFIG_MISSING"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export function apiOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function apiError(code: ApiErrorCode, message: string, status = 400) {
  return NextResponse.json({ code, message }, { status });
}

export function toPublicError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "请求处理失败";
}
