"use client";

import React, { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageCircle,
  Send,
  Wrench,
} from "lucide-react";

export { getAgentConversationHref } from "@/lib/app-routes";

type AgentMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

type AgentToolCall = {
  id: string;
  name: string;
  status: string;
  durationMs?: number | null;
  error?: string | null;
  createdAt: string;
};

type AgentSessionPayload = {
  id: string;
  tripId?: string | null;
  status: string;
  prompt: string;
  messages: AgentMessage[];
  toolCalls: AgentToolCall[];
};

type AgentEvent = {
  id: string;
  kind: "message" | "tool";
  title: string;
  detail: string;
  status: string;
  createdAt: string;
};

const TERMINAL_STATUSES = new Set(["completed", "failed", "timed_out", "cancelled"]);
const REDIRECT_DELAY_MS = 1200;

export function formatAgentToolName(name: string) {
  const labels: Record<string, string> = {
    create_trip: "创建行程",
    get_bicycling_route: "查询骑行路线",
    get_transit_route: "查询公交/地铁路线",
    get_walking_route: "查询步行路线",
    get_weather_reference: "获取天气参考",
    read_memories: "读取记忆",
    read_settings: "读取设置",
    search_poi: "搜索地点",
  };

  return labels[name] ?? "工具调用";
}

function formatStatus(status: string) {
  const labels: Record<string, string> = {
    assistant: "智能体",
    cancelled: "已取消",
    completed: "已完成",
    failed: "失败",
    loading: "加载中",
    running: "运行中",
    timed_out: "已超时",
    tool: "工具",
    user: "用户",
  };

  return labels[status] ?? status;
}

export function buildAgentEvents(session: {
  messages: AgentMessage[];
  toolCalls: AgentToolCall[];
}): AgentEvent[] {
  return [
    ...session.messages.map((message) => ({
      id: `message-${message.id}`,
      kind: "message" as const,
      title: message.role === "assistant" ? "智能体更新" : "用户请求",
      detail: message.content,
      status: message.role,
      createdAt: message.createdAt,
    })),
    ...session.toolCalls.map((tool) => ({
      id: `tool-${tool.id}`,
      kind: "tool" as const,
      title: formatAgentToolName(tool.name),
      detail:
        tool.error ??
        (tool.durationMs ? `${tool.durationMs} 毫秒` : "已记录工具调用"),
      status: tool.status,
      createdAt: tool.createdAt,
    })),
  ].sort((left, right) => {
    const timeDelta =
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();

    return timeDelta || left.id.localeCompare(right.id);
  });
}

export function getAgentSessionViewState({
  autoRedirect,
  session,
}: {
  autoRedirect: boolean;
  session?: Pick<AgentSessionPayload, "status" | "tripId"> | null;
}) {
  const status = session?.status ?? "loading";
  const isTerminal = session ? TERMINAL_STATUSES.has(status) : false;
  const redirectTo =
    autoRedirect && status === "completed" && session?.tripId
      ? `/trips/${session.tripId}`
      : null;

  return {
    isLoading: !session || !isTerminal,
    isTerminal,
    redirectDelayMs: redirectTo ? REDIRECT_DELAY_MS : 0,
    redirectTo,
    status,
  };
}

export function getAgentSendMessageResult(
  status: number,
  payload: { error?: unknown; status?: unknown }
) {
  if (status >= 200 && status < 300 && payload.status === "running") {
    return { accepted: true, error: "" };
  }

  return {
    accepted: false,
    error: typeof payload.error === "string" ? payload.error : "无法发送消息",
  };
}

export function AgentEventList({
  autoRedirect = true,
  sessionId,
}: {
  autoRedirect?: boolean;
  sessionId: string;
}) {
  const router = useRouter();
  const [session, setSession] = useState<AgentSessionPayload | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [pollingVersion, setPollingVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let interval: number | undefined;

    function stopPolling() {
      if (interval !== undefined) {
        window.clearInterval(interval);
        interval = undefined;
      }
    }

    async function poll() {
      let response: Response;
      let payload: { error?: unknown; session?: AgentSessionPayload };

      try {
        response = await fetch(`/api/agent-sessions/${sessionId}`);
        payload = await response.json().catch(() => ({}));
      } catch {
        if (!cancelled) {
          setError("无法加载智能体会话。");
        }
        return;
      }

      if (cancelled) {
        return;
      }

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "无法加载智能体会话。");
        return;
      }

      if (!payload.session) {
        setError("无法加载智能体会话。");
        return;
      }

      setSession(payload.session);
      setError("");

      const viewState = getAgentSessionViewState({
        autoRedirect,
        session: payload.session,
      });

      if (viewState.redirectTo) {
        window.setTimeout(() => {
          if (!cancelled && viewState.redirectTo) {
            router.push(viewState.redirectTo);
          }
        }, viewState.redirectDelayMs);
      }
      if (viewState.isTerminal) {
        stopPolling();
      }
    }

    void poll();
    interval = window.setInterval(poll, 2500);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [autoRedirect, pollingVersion, router, sessionId]);

  async function onSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSendDisabled) {
      return;
    }

    const trimmed = message.trim();

    if (!trimmed) {
      setError("请输入要告诉智能体的内容");
      return;
    }

    setError("");
    setIsSending(true);

    try {
      const response = await fetch(`/api/agent-sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const payload = await response.json().catch(() => ({}));
      const result = getAgentSendMessageResult(response.status, payload);

      if (!result.accepted) {
        setError(result.error);
        return;
      }

      setMessage("");
      setError("");

      const refreshedResponse = await fetch(`/api/agent-sessions/${sessionId}`);
      const refreshedPayload = await refreshedResponse.json().catch(() => ({}));

      if (refreshedResponse.ok && refreshedPayload.session) {
        setSession(refreshedPayload.session);
      }

      setPollingVersion((version) => version + 1);
    } catch {
      setError("无法发送消息");
    } finally {
      setIsSending(false);
    }
  }

  const events = session
    ? buildAgentEvents(session)
    : [];
  const viewState = getAgentSessionViewState({ autoRedirect, session });
  const isSendDisabled = isSending || viewState.status === "running";

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#434655]">
            智能体会话
          </p>
          <h1 className="mt-1 text-2xl font-bold text-[#191c1e]">
            正在规划你的通勤
          </h1>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-[#dae2fd] px-3 py-2 text-sm font-bold text-[#3f465c]">
          {viewState.status === "completed" ? (
            <CheckCircle2 aria-hidden="true" className="size-4" />
          ) : viewState.isLoading ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <AlertCircle aria-hidden="true" className="size-4" />
          )}
          {formatStatus(viewState.status)}
        </div>
      </div>

      <div className="rounded-2xl bg-white/60 p-4">
        <p className="text-sm font-semibold text-[#434655]">输入请求</p>
        <p className="mt-1 break-words text-base text-[#191c1e]">
          {session?.prompt ?? "正在加载请求..."}
        </p>
      </div>

      {error ? (
        <p className="rounded-2xl bg-[#ffdad6] p-4 text-sm font-semibold text-[#93000a]">
          {error}
        </p>
      ) : null}

      {!autoRedirect ? (
        <form className="rounded-2xl bg-white/60 p-3" onSubmit={onSendMessage}>
          <div className="flex gap-2">
            <input
              aria-label="告诉智能体更多信息"
              className="min-w-0 flex-1 rounded-full bg-[#f2f4f6] px-4 py-3 text-sm font-medium text-[#191c1e] outline-none ring-[#2563eb]/20 transition placeholder:text-[#737686] focus:bg-white focus:ring-4"
              disabled={isSendDisabled}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="继续补充你的通勤需求"
              value={message}
            />
            <button
              aria-label="发送给智能体"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#2563eb] text-white shadow-sm transition hover:bg-[#004ac6] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSendDisabled}
              type="submit"
            >
              {isSending ? (
                <Loader2 aria-hidden="true" className="size-5 animate-spin" />
              ) : (
                <Send aria-hidden="true" className="size-5" />
              )}
            </button>
          </div>
        </form>
      ) : null}

      <div className="grid grid-cols-[36px_1fr] gap-x-3">
        {events.length === 0 ? (
          <>
            <div className="flex justify-center pt-1">
              <Clock3 aria-hidden="true" className="size-5 text-[#2563eb]" />
            </div>
            <p className="rounded-2xl bg-white/60 px-4 py-5 text-sm font-medium text-[#434655]">
              智能体正在启动。消息和工具调用会显示在这里。
            </p>
          </>
        ) : (
          events.map((event, index) => (
            <div className="contents" key={event.id}>
              <div className="flex flex-col items-center gap-1 pt-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-[#f2f4f6] text-[#2563eb]">
                  {event.kind === "tool" ? (
                    <Wrench aria-hidden="true" className="size-4" />
                  ) : (
                    <MessageCircle aria-hidden="true" className="size-4" />
                  )}
                </div>
                {index < events.length - 1 ? (
                  <div className="min-h-5 w-px grow bg-[#c3c6d7]" />
                ) : null}
              </div>
              <div className="min-w-0 py-3">
                <div className="rounded-2xl bg-white/65 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="break-words text-sm font-bold text-[#191c1e]">
                      {event.title}
                    </p>
                    <span className="shrink-0 rounded-full bg-[#f2f4f6] px-2.5 py-1 text-xs font-bold text-[#434655]">
                      {formatStatus(event.status)}
                    </span>
                  </div>
                  <p className="mt-2 break-words text-sm leading-6 text-[#434655]">
                    {event.detail}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
