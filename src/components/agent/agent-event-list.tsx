"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageCircle,
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

export function buildAgentEvents(session: {
  messages: AgentMessage[];
  toolCalls: AgentToolCall[];
}): AgentEvent[] {
  return [
    ...session.messages.map((message) => ({
      id: `message-${message.id}`,
      kind: "message" as const,
      title: message.role === "assistant" ? "Agent update" : "Request",
      detail: message.content,
      status: message.role,
      createdAt: message.createdAt,
    })),
    ...session.toolCalls.map((tool) => ({
      id: `tool-${tool.id}`,
      kind: "tool" as const,
      title: tool.name,
      detail:
        tool.error ??
        (tool.durationMs ? `${tool.durationMs} ms` : "Tool call recorded"),
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
    redirectTo,
    status,
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
      const response = await fetch(`/api/agent-sessions/${sessionId}`);
      const payload = await response.json().catch(() => ({}));

      if (cancelled) {
        return;
      }

      if (!response.ok) {
        setError(payload.error ?? "Unable to load agent session.");
        return;
      }

      setSession(payload.session);
      setError("");

      const viewState = getAgentSessionViewState({
        autoRedirect,
        session: payload.session,
      });

      if (viewState.redirectTo) {
        router.push(viewState.redirectTo);
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
  }, [autoRedirect, router, sessionId]);

  const events = session
    ? buildAgentEvents(session)
    : [];
  const viewState = getAgentSessionViewState({ autoRedirect, session });

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#434655]">
            Agent session
          </p>
          <h1 className="mt-1 text-2xl font-bold text-[#191c1e]">
            Planning your commute
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
          {viewState.status}
        </div>
      </div>

      <div className="rounded-2xl bg-white/60 p-4">
        <p className="text-sm font-semibold text-[#434655]">Prompt</p>
        <p className="mt-1 break-words text-base text-[#191c1e]">
          {session?.prompt ?? "Loading request..."}
        </p>
      </div>

      {error ? (
        <p className="rounded-2xl bg-[#ffdad6] p-4 text-sm font-semibold text-[#93000a]">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-[36px_1fr] gap-x-3">
        {events.length === 0 ? (
          <>
            <div className="flex justify-center pt-1">
              <Clock3 aria-hidden="true" className="size-5 text-[#2563eb]" />
            </div>
            <p className="rounded-2xl bg-white/60 px-4 py-5 text-sm font-medium text-[#434655]">
              The agent is starting. Messages and tool calls will appear here.
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
                      {event.status}
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
