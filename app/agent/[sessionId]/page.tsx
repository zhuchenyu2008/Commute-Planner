import { redirect } from "next/navigation";
import { Bot } from "lucide-react";
import { AgentEventList } from "@/components/agent/agent-event-list";
import { AppShell } from "@/components/app-shell";
import { GlassCard } from "@/components/glass-card";
import { getCurrentUser } from "@/lib/auth/session";

type AgentPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
  searchParams?: Promise<{
    view?: string;
  }>;
};

export default async function AgentPage({ params, searchParams }: AgentPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { sessionId } = await params;
  const view = (await searchParams)?.view;
  const autoRedirect = view !== "conversation";

  return (
    <AppShell active="home">
      <div className="mx-auto max-w-3xl space-y-5">
        <GlassCard className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-full bg-[#2563eb] text-white">
              <Bot aria-hidden="true" className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#434655]">Live planning</p>
              <p className="text-lg font-bold text-[#191c1e]">
                Agent conversation
              </p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-5">
          <AgentEventList autoRedirect={autoRedirect} sessionId={sessionId} />
        </GlassCard>
      </div>
    </AppShell>
  );
}
