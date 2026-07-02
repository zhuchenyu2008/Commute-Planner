import { NextResponse } from "next/server";
import { createAmapClient } from "@/lib/amap";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const url = new URL(request.url);
  const keywords = url.searchParams.get("keywords")?.trim() ?? "";
  const city = url.searchParams.get("city")?.trim() || undefined;

  if (!keywords) {
    return NextResponse.json({ error: "请输入地点关键词" }, { status: 400 });
  }

  try {
    const places = await createAmapClient().searchPoi({ keywords, city });

    return NextResponse.json({ places });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";

    return NextResponse.json(
      { error: `地点搜索失败：${detail}` },
      { status: 502 }
    );
  }
}
