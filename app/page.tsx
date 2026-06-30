import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Brain,
  Clock3,
  CloudSun,
  History,
  MapPin,
  Navigation,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { GlassCard } from "@/components/glass-card";
import { CommuteInput } from "@/components/home/commute-input";
import { CurrentLocationLabel } from "@/components/home/current-location-label";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  formatHistoryTripSummary,
  formatHomeTripStatus,
  formatLatestMemorySummary,
  type HomeTripStatusTone,
} from "@/lib/home/summary";
import { getTripDisplayStatus } from "@/lib/trips/display-status";

const toneClasses: Record<HomeTripStatusTone, string> = {
  danger: "bg-[#ffdad6] text-[#93000a]",
  neutral: "bg-[#f2f4f6] text-[#434655]",
  success: "bg-[#10B981]/10 text-[#047857]",
  warning: "bg-[#F59E0B]/15 text-[#92400e]",
};

const historyDotClasses: Record<string, string> = {
  cancelled: "bg-[#8a92a6]",
  completed: "bg-[#0f9f6e]",
  expired: "bg-[#F59E0B]",
  failed: "bg-[#b42318]",
  monitoring: "bg-[#10B981]",
  scheduled: "bg-[#2563eb]",
};

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const [settings, latestTrip, recentTrips, latestMemory, pendingMemoryCount] =
    await Promise.all([
    prisma.userSettings.findUnique({
      where: { userId: user.id },
    }),
    prisma.trip.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        legs: {
          orderBy: { order: "asc" },
          include: { selectedCandidate: true },
        },
      },
    }),
    prisma.trip.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 3,
    }),
      prisma.memory.findFirst({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.memoryCandidate.count({
        where: { userId: user.id, status: "pending" },
      }),
    ]);
  const defaultCity = settings?.defaultCity ?? "宁波";
  const currentLocationName = settings?.originName ?? defaultCity;
  const latestTripStatus = formatHomeTripStatus(latestTrip);
  const latestTripHref = latestTrip ? `/trips/${latestTrip.id}` : "/history";
  const firstLeg = latestTrip?.legs[0];
  const latestMinutes =
    firstLeg?.selectedCandidate?.totalMinutes ??
    firstLeg?.selectedCandidate?.routeMinutes ??
    null;

  return (
    <AppShell active="home">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.05em] text-[#434655]">
              <MapPin aria-hidden="true" className="size-4 text-[#2563eb]" />
              当前位置
            </p>
            <h1 className="text-3xl font-bold leading-tight text-[#191c1e] md:text-4xl">
              <CurrentLocationLabel
                className="block"
                fallbackCity={currentLocationName}
              />
            </h1>
          </div>
          <GlassCard className="flex shrink-0 items-center gap-2 rounded-xl p-3">
            <CloudSun aria-hidden="true" className="size-6 text-[#F59E0B]" />
            <div>
              <p className="text-sm font-bold text-[#191c1e]">24°C</p>
              <p className="text-xs font-medium text-[#434655]">
                稍后小雨
              </p>
            </div>
          </GlassCard>
        </header>

        <section className="py-4">
          <CommuteInput />
        </section>

        <section className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
          <Link className="block" href={latestTripHref}>
            <GlassCard className="p-6 transition hover:bg-white/85">
              <div className="flex items-center justify-between gap-4">
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${toneClasses[latestTripStatus.tone]}`}
                >
                  {latestTripStatus.label}
                </span>
                <span className="inline-flex items-center gap-1 text-sm font-bold text-[#2563eb]">
                  实时状态
                  <ArrowRight aria-hidden="true" className="size-4" />
                </span>
              </div>
              <div className="mt-5 space-y-2">
                <h2 className="break-words text-2xl font-semibold text-[#191c1e]">
                  {latestTripStatus.title}
                </h2>
                <p className="text-sm leading-6 text-[#434655]">
                  {latestTripStatus.description}
                  {latestMinutes ? ` · 预计 ${latestMinutes} 分钟` : ""}
                </p>
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-[#c3c6d7]/50 pt-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#434655]">
                  <Navigation aria-hidden="true" className="size-4" />
                  最近一个行程
                </div>
                <span className="text-sm font-bold text-[#2563eb]">
                  查看详情
                </span>
              </div>
            </GlassCard>
          </Link>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-1">
            <Link className="block" href="/history">
              <GlassCard className="h-full p-4 transition hover:bg-white/85">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-bold text-[#191c1e]">
                    <History aria-hidden="true" className="size-4 text-[#2563eb]" />
                    最近历史
                  </p>
                  <ArrowRight aria-hidden="true" className="size-4 text-[#434655]" />
                </div>
                <div className="mt-3 space-y-2">
                  {recentTrips.length === 0 ? (
                    <p className="text-xs font-medium text-[#434655]">
                      暂无历史行程
                    </p>
                  ) : (
                    recentTrips.map((trip) => {
                      const displayStatus = getTripDisplayStatus({
                        status: trip.status,
                        targetArriveAt: trip.targetArriveAt,
                      });

                      return (
                        <div className="flex gap-2" key={trip.id}>
                          <span
                            className={`mt-1 size-2.5 shrink-0 rounded-full ${
                              historyDotClasses[displayStatus.key] ??
                              "bg-[#c3c6d7]"
                            }`}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-[#191c1e]">
                              {trip.title}
                            </p>
                            <p className="mt-0.5 truncate text-xs font-medium text-[#434655]">
                              {formatHistoryTripSummary(trip)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </GlassCard>
            </Link>
            <Link className="block" href="/memories">
              <GlassCard className="h-full p-4 transition hover:bg-white/85">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-bold text-[#191c1e]">
                    <Brain aria-hidden="true" className="size-4 text-[#2563eb]" />
                    通勤记忆
                  </p>
                  <ArrowRight aria-hidden="true" className="size-4 text-[#434655]" />
                </div>
                <p className="mt-3 rounded-2xl bg-white/55 px-3 py-3 text-xs font-bold leading-5 text-[#191c1e]">
                  {formatLatestMemorySummary(latestMemory)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-medium text-[#737686]">
                  {latestMemory ? (
                    <span className="flex items-center gap-1">
                    <Clock3 aria-hidden="true" className="size-3.5" />
                    {formatShortDate(latestMemory.updatedAt)}
                    </span>
                  ) : null}
                  {pendingMemoryCount > 0 ? (
                    <span className="rounded-full bg-[#f4f0ff] px-2 py-1 font-bold text-[#5140a8]">
                      {pendingMemoryCount} 条待确认
                    </span>
                  ) : null}
                </div>
              </GlassCard>
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
