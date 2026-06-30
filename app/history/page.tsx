import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock3, MapPin } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { GlassCard } from "@/components/glass-card";
import { HistoryDateFilter } from "@/components/history/history-date-filter";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getBeijingDayRange } from "@/lib/history/day-filter";
import {
  getTripDisplayStatus,
  type TripDisplayTone,
} from "@/lib/trips/display-status";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const statusClasses: Record<TripDisplayTone, string> = {
  danger: "bg-[#ffdad6] text-[#93000a]",
  neutral: "bg-[#eeeef7] text-[#5d6072]",
  success: "bg-[#dcfce7] text-[#166534]",
  warning: "bg-[#fef3c7] text-[#92400e]",
};

type HistoryPageProps = {
  searchParams?: Promise<{
    date?: string;
  }>;
};

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;
  const dayRange = getBeijingDayRange(params?.date);
  const trips = await prisma.trip.findMany({
    where: {
      userId: user.id,
      createdAt: {
        gte: dayRange.start,
        lt: dayRange.end,
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      legs: {
        orderBy: { order: "asc" },
        include: { selectedCandidate: true },
      },
    },
  });

  return (
    <AppShell active="history">
      <div className="mx-auto max-w-3xl space-y-5">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#434655]">
            行程归档
          </p>
          <h1 className="mt-1 text-3xl font-bold text-[#191c1e]">历史行程</h1>
          <HistoryDateFilter value={dayRange.value} />
        </header>

        {trips.length === 0 ? (
          <GlassCard className="p-6">
            <p className="text-sm font-medium text-[#434655]">
              当天暂无历史行程。
            </p>
          </GlassCard>
        ) : (
          <section className="space-y-3">
            {trips.map((trip) => {
              const firstLeg = trip.legs[0];
              const minutes =
                firstLeg?.selectedCandidate?.totalMinutes ??
                firstLeg?.selectedCandidate?.routeMinutes;
              const displayStatus = getTripDisplayStatus({
                status: trip.status,
                targetArriveAt: trip.targetArriveAt,
              });

              return (
                <Link className="block" href={`/trips/${trip.id}`} key={trip.id}>
                  <GlassCard className="p-5 transition hover:bg-white/85">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="break-words text-lg font-bold text-[#191c1e]">
                          {trip.title}
                        </p>
                        <p className="mt-1 flex items-center gap-1 text-sm text-[#434655]">
                          <MapPin aria-hidden="true" className="size-4" />
                          {trip.finalStopName ?? "目的地待定"}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                          statusClasses[displayStatus.tone]
                        }`}
                      >
                        {displayStatus.label}
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm font-medium text-[#434655]">
                      <span className="flex items-center gap-1">
                        <Clock3 aria-hidden="true" className="size-4" />
                        {formatDate(trip.createdAt)}
                      </span>
                      {typeof minutes === "number" ? (
                        <span>{minutes} 分钟</span>
                      ) : null}
                    </div>
                  </GlassCard>
                </Link>
              );
            })}
          </section>
        )}
      </div>
    </AppShell>
  );
}
