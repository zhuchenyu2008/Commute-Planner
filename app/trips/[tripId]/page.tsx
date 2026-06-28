import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Bell,
  Bot,
  Clock3,
  Map,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { GlassCard } from "@/components/glass-card";
import { BufferList } from "@/components/trips/buffer-list";
import { MonitoringActions } from "@/components/trips/monitoring-actions";
import { RouteTimeline } from "@/components/trips/route-timeline";
import { getCurrentUser } from "@/lib/auth/session";
import { getAgentConversationHref } from "@/lib/app-routes";
import { prisma } from "@/lib/db";
import {
  getMonitoringStatusDisplay,
  getMonitoringSummary,
} from "@/lib/trips/monitoring";

type TripPageProps = {
  params: Promise<{
    tripId: string;
  }>;
};

function formatTime(date?: Date | null) {
  if (!date) {
    return "待定";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDateTime(date?: Date | null) {
  if (!date) {
    return "待定";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatStatus(status?: string | null) {
  const labels: Record<string, string> = {
    cancelled: "已取消",
    completed: "已完成",
    failed: "失败",
    monitoring: "监控中",
    pending: "待处理",
    running: "运行中",
    scheduled: "已计划",
    sent: "已发送",
    skipped: "已跳过",
    timed_out: "已超时",
  };

  return status ? labels[status] ?? status : "待定";
}

function formatReminderKind(kind: string) {
  const labels: Record<string, string> = {
    depart_now: "现在出发",
    recheck: "路线复查",
  };

  return labels[kind] ?? kind;
}

function formatTrigger(trigger?: string | null) {
  const labels: Record<string, string> = {
    manual: "手动",
    reminder: "提醒",
    scheduler: "调度器",
  };

  return trigger ? labels[trigger] ?? trigger : "未知";
}

export default async function TripDetailPage({ params }: TripPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { tripId } = await params;
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: user.id },
    include: {
      agentSessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      legs: {
        orderBy: { order: "asc" },
        include: {
          selectedCandidate: true,
          routeCandidates: {
            orderBy: { createdAt: "asc" },
          },
          routeSegments: {
            orderBy: { order: "asc" },
          },
          bufferComponents: {
            orderBy: { order: "asc" },
          },
          reminderJobs: {
            orderBy: { scheduledFor: "asc" },
          },
          recalculations: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
      reminderJobs: {
        orderBy: { scheduledFor: "asc" },
      },
      recalculations: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      stops: {
        orderBy: { order: "asc" },
      },
    },
  });

  if (!trip) {
    redirect("/history");
  }

  const primaryLeg = trip.legs[0];
  const selectedCandidates = trip.legs.flatMap((leg) => {
    const candidate =
      leg.selectedCandidate ??
      leg.routeCandidates.find((routeCandidate) => routeCandidate.selected) ??
      leg.routeCandidates[0];

    return candidate ? [candidate] : [];
  });
  const totalRouteMinutes = selectedCandidates.reduce(
    (sum, candidate) => sum + candidate.routeMinutes,
    0
  );
  const totalBufferMinutes = selectedCandidates.reduce(
    (sum, candidate) => sum + candidate.bufferMinutes,
    0
  );
  const routeGroups = trip.legs.map((leg) => ({
    id: leg.id,
    title: `${leg.originName} 到 ${leg.destinationName}`,
    subtitle: [
      leg.latestDepartAt ? `${formatTime(leg.latestDepartAt)} 前出发` : null,
      leg.targetArriveAt ? `${formatTime(leg.targetArriveAt)} 前到达` : null,
    ]
      .filter(Boolean)
      .join(" / "),
    segments: leg.routeSegments.map((segment) => ({
      id: segment.id,
      mode: segment.mode,
      title: segment.title,
      detail: segment.detail,
      minutes: segment.minutes,
    })),
  }));
  const buffers = trip.legs.flatMap((leg) =>
    leg.bufferComponents.map((buffer) => ({
      id: buffer.id,
      category: buffer.category,
      label:
        trip.legs.length > 1
          ? `${leg.destinationName}: ${buffer.label}`
          : buffer.label,
      minutes: buffer.minutes,
      reason: buffer.reason,
      source: buffer.source,
    }))
  );
  const reminders = trip.reminderJobs;
  const monitoringSummary = getMonitoringSummary({
    createdAt: trip.createdAt,
    scheduledReminderCount: reminders.filter(
      (reminder) => reminder.status === "scheduled"
    ).length,
  });
  const latestRecalculation = [
    ...trip.recalculations,
    ...trip.legs.flatMap((leg) => leg.recalculations),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const monitoringStatusDisplay = getMonitoringStatusDisplay({
    tripStatus: trip.status,
    latestRecalculation,
  });
  const agentSessionId = trip.agentSessions[0]?.id ?? trip.agentSessionId;
  const routeTitle =
    selectedCandidates.length > 1
      ? `已选择 ${selectedCandidates.length} 段路线`
      : selectedCandidates[0]?.title;
  const mapPath = [
    primaryLeg?.originName,
    ...trip.stops.map((stop) => stop.name),
  ].filter(Boolean);

  return (
    <AppShell active="history">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="space-y-4">
          <Link
            className="text-sm font-bold text-[#2563eb] hover:text-[#004ac6]"
            href="/history"
          >
            返回历史
          </Link>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#434655]">
                已选路线
              </p>
              <h1 className="mt-1 break-words text-3xl font-bold leading-tight text-[#191c1e]">
                {trip.title}
              </h1>
              <p className="mt-2 text-sm text-[#434655]">
                目标到达 {formatDateTime(trip.targetArriveAt)}
              </p>
            </div>
            {agentSessionId ? (
              <Link
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#2563eb] px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#004ac6]"
                href={getAgentConversationHref(agentSessionId)}
              >
                <Bot aria-hidden="true" className="size-4" />
                智能体对话
              </Link>
            ) : null}
          </div>
        </header>

        <GlassCard className="p-5">
          <div className="grid gap-5 md:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-xl bg-[#f2f4f6] text-[#191c1e]">
                  <Clock3 aria-hidden="true" className="size-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#434655]">
                    最晚出发时间
                  </p>
                  <p className="text-2xl font-bold text-[#191c1e]">
                    {formatTime(primaryLeg?.latestDepartAt)}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-[#434655]">
                  {routeTitle ?? "路线方案待定"}
                </p>
                <p className="mt-1 text-base font-semibold text-[#191c1e]">
                  {selectedCandidates.length > 0
                    ? `路程 ${totalRouteMinutes} 分钟 + 缓冲 ${totalBufferMinutes} 分钟`
                    : "智能体尚未选择路线。"}
                </p>
              </div>
            </div>
            <div className="min-h-36 rounded-2xl bg-[linear-gradient(135deg,rgba(219,225,255,0.9),rgba(255,255,255,0.35)),linear-gradient(35deg,transparent_0_38%,rgba(37,99,235,0.45)_38.5%,transparent_40%_100%),linear-gradient(120deg,transparent_0_58%,rgba(195,198,215,0.8)_58.5%,transparent_60%_100%)] p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-[#191c1e]">
                <Map aria-hidden="true" className="size-5 text-[#2563eb]" />
                地图参考
              </div>
              <p className="mt-10 text-sm font-medium text-[#434655]">
                {mapPath.length > 1
                  ? mapPath.join(" -> ")
                  : `${primaryLeg?.originName ?? "出发点"} 到 ${
                      trip.finalStopName ??
                      primaryLeg?.destinationName ??
                      "目的地"
                    }`}
              </p>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="text-lg font-bold text-[#191c1e]">路线分段</h2>
          <div className="mt-3">
            <RouteTimeline groups={routeGroups} />
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="size-5 text-[#2563eb]" />
            <h2 className="text-lg font-bold text-[#191c1e]">缓冲时间</h2>
          </div>
          <p className="mt-1 text-sm text-[#434655]">
            天气仅作为参考信息，不直接计入路程时间。
          </p>
          <div className="mt-4">
            <BufferList buffers={buffers} />
          </div>
        </GlassCard>

        <section className="grid gap-5 md:grid-cols-2">
          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <Bell aria-hidden="true" className="size-5 text-[#2563eb]" />
              <h2 className="text-lg font-bold text-[#191c1e]">提醒计划</h2>
            </div>
            <div className="mt-4 space-y-3">
              {reminders.length === 0 ? (
                <p className="text-sm font-medium text-[#434655]">
                  暂无提醒计划。
                </p>
              ) : (
                reminders.map((reminder) => (
                  <div
                    className="flex items-center justify-between gap-4 rounded-2xl bg-white/65 p-4"
                    key={reminder.id}
                  >
                    <div>
                      <p className="text-sm font-bold text-[#191c1e]">
                        {formatReminderKind(reminder.kind)}
                      </p>
                      <p className="mt-1 text-xs font-medium text-[#434655]">
                        {formatDateTime(reminder.scheduledFor)}
                      </p>
                    </div>
                    <span className="rounded-full bg-[#f2f4f6] px-3 py-1 text-xs font-bold text-[#434655]">
                      {formatStatus(reminder.status)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <RefreshCw aria-hidden="true" className="size-5 text-[#2563eb]" />
              <h2 className="text-lg font-bold text-[#191c1e]">
                监控状态
              </h2>
            </div>
            <div className="mt-4 rounded-2xl bg-[#d3e4fe] p-4">
              <p className="text-sm font-bold text-[#0b1c30]">
                {monitoringStatusDisplay.title}
              </p>
              <p className="mt-1 text-sm leading-6 text-[#38485d]">
                {monitoringStatusDisplay.description}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-white/65 p-3">
                  <p className="font-medium text-[#38485d]">已监控</p>
                  <p className="mt-1 font-bold text-[#0b1c30]">
                    {monitoringSummary.monitoredFor}
                  </p>
                </div>
                <div className="rounded-xl bg-white/65 p-3">
                  <p className="font-medium text-[#38485d]">待提醒</p>
                  <p className="mt-1 font-bold text-[#0b1c30]">
                    {monitoringSummary.scheduledReminderCount}
                  </p>
                </div>
              </div>
              {latestRecalculation ? (
                <div className="mt-3 space-y-1 text-xs font-semibold uppercase tracking-[0.05em] text-[#38485d]">
                  <p>最近复算：{formatStatus(latestRecalculation.status)}</p>
                  {latestRecalculation.summary ? (
                    <p className="normal-case tracking-normal">
                      {latestRecalculation.summary}
                    </p>
                  ) : null}
                  <p>触发来源：{formatTrigger(latestRecalculation.trigger)}</p>
                </div>
              ) : null}
              <MonitoringActions tripId={trip.id} status={trip.status} />
            </div>
          </GlassCard>
        </section>
      </div>
    </AppShell>
  );
}
