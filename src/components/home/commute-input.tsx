"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic, Search } from "lucide-react";

export function getAgentStartResult(
  status: number,
  payload: { error?: unknown; sessionId?: unknown }
) {
  if (status === 401) {
    return { error: "", route: "/login" };
  }

  if (status >= 200 && status < 300 && typeof payload.sessionId === "string") {
    return { error: "", route: `/agent/${payload.sessionId}` };
  }

  return {
    error: typeof payload.error === "string" ? payload.error : "Could not start planning.",
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
      setError("Enter a destination or commute request.");
      return;
    }

    setError("");
    setIsSubmitting(true);

    const response = await fetch("/api/agent-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: trimmedPrompt }),
    });
    const payload = await response.json().catch(() => ({}));

    setIsSubmitting(false);

    const result = getAgentStartResult(response.status, payload);

    if (!result.route) {
      setError(result.error);
      return;
    }

    router.push(result.route);
  }

  return (
    <form className="w-full space-y-3" onSubmit={onSubmit}>
      <div className="group relative">
        <Search
          aria-hidden="true"
          className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#737686] transition group-focus-within:text-[#2563eb]"
        />
        <input
          aria-label="Search destination"
          className="h-16 w-full rounded-full border-0 bg-[#f2f4f6] px-12 pr-28 text-lg text-[#191c1e] shadow-sm outline-none ring-[#2563eb]/20 transition placeholder:text-[#737686] focus:bg-white focus:ring-4"
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Where do you need to be?"
          value={prompt}
        />
        <button
          aria-label="Voice input"
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
            <Loader2 aria-label="Planning" className="size-5 animate-spin" />
          ) : (
            "Plan"
          )}
        </button>
      </div>
      <p className="min-h-5 text-center text-xs font-medium uppercase tracking-[0.05em] text-[#434655]">
        {error || "Type a destination, deadline, or full commute goal"}
      </p>
    </form>
  );
}
