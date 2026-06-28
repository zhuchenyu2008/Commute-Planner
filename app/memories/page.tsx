import { redirect } from "next/navigation";
import { Brain, CircleDashed } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { GlassCard } from "@/components/glass-card";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export default async function MemoriesPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const [memories, memoryCandidates] = await Promise.all([
    prisma.memory.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.memoryCandidate.findMany({
      where: { userId: user.id, status: "pending" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <AppShell active="memories">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#434655]">
            Personal context
          </p>
          <h1 className="mt-1 text-3xl font-bold text-[#191c1e]">Memories</h1>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-[#191c1e]">Confirmed</h2>
          {memories.length === 0 ? (
            <GlassCard className="p-5 text-sm font-medium text-[#434655]">
              No confirmed commute memories yet.
            </GlassCard>
          ) : (
            memories.map((memory) => (
              <GlassCard className="p-5" key={memory.id}>
                <div className="flex items-start gap-3">
                  <Brain
                    aria-hidden="true"
                    className="mt-1 size-5 shrink-0 text-[#2563eb]"
                  />
                  <div className="min-w-0">
                    <p className="break-words text-base font-bold text-[#191c1e]">
                      {memory.label}
                    </p>
                    <p className="mt-1 text-sm font-medium text-[#434655]">
                      {memory.kind}
                    </p>
                  </div>
                </div>
              </GlassCard>
            ))
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-[#191c1e]">Pending</h2>
          {memoryCandidates.length === 0 ? (
            <GlassCard className="p-5 text-sm font-medium text-[#434655]">
              No pending memory candidates.
            </GlassCard>
          ) : (
            memoryCandidates.map((candidate) => (
              <GlassCard className="p-5" key={candidate.id}>
                <div className="flex items-start gap-3">
                  <CircleDashed
                    aria-hidden="true"
                    className="mt-1 size-5 shrink-0 text-[#565e74]"
                  />
                  <div className="min-w-0">
                    <p className="break-words text-base font-bold text-[#191c1e]">
                      {candidate.label}
                    </p>
                    <p className="mt-1 text-sm font-medium text-[#434655]">
                      {candidate.kind}
                    </p>
                  </div>
                </div>
              </GlassCard>
            ))
          )}
        </section>
      </div>
    </AppShell>
  );
}
