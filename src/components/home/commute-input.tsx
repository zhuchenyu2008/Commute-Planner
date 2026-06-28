"use client";

import React, { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic, Search } from "lucide-react";

export function getAgentStartResult(
  status: number,
  payload: { actionHref?: unknown; error?: unknown; sessionId?: unknown }
) {
  if (status === 401) {
    return { error: "", route: "/login" };
  }

  if (status >= 200 && status < 300 && typeof payload.sessionId === "string") {
    return { error: "", route: `/agent/${payload.sessionId}` };
  }

  if (typeof payload.actionHref === "string") {
    return {
      error: typeof payload.error === "string" ? payload.error : "请先完成设置",
      route: payload.actionHref,
    };
  }

  return {
    error: typeof payload.error === "string" ? payload.error : "无法开始规划。",
    route: null,
  };
}

export function CommuteInput() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      setError("请输入目的地或通勤需求。");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/agent-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmedPrompt }),
      });
      const payload = await response.json().catch(() => ({}));

      const result = getAgentStartResult(response.status, payload);

      if (!result.route) {
        setError(result.error);
        return;
      }

      router.push(result.route);
    } catch {
      setError("无法开始规划。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="w-full space-y-3" onSubmit={onSubmit}>
      <div className="group relative">
        <Search
          aria-hidden="true"
          className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#737686] transition group-focus-within:text-[#2563eb]"
        />
        <input
          aria-label="搜索目的地"
          className="h-16 w-full rounded-full border-0 bg-[#f2f4f6] px-12 pr-28 text-lg text-[#191c1e] shadow-sm outline-none ring-[#2563eb]/20 transition placeholder:text-[#737686] focus:bg-white focus:ring-4"
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="你要去哪，几点到？"
          value={prompt}
        />
        <button
          aria-label="语音输入"
          className="absolute right-16 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-[#2563eb] transition hover:bg-[#dbe1ff]"
          type="button"
        >
          <Mic aria-hidden="true" className="size-5" />
        </button>
        <button
          className="absolute right-2 top-1/2 flex h-12 min-w-12 -translate-y-1/2 items-center justify-center rounded-full bg-[#2563eb] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#004ac6] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? (
            <Loader2 aria-label="正在规划" className="size-5 animate-spin" />
          ) : (
            "规划"
          )}
        </button>
      </div>
      <p className="min-h-5 text-center text-xs font-medium uppercase tracking-[0.05em] text-[#434655]">
        {error || "输入目的地、到达时间或完整通勤目标"}
      </p>
    </form>
  );
}
