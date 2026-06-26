"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/ui/AppShell";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
import { apiFetch } from "@/lib/client/api";

type Trip = {
  id: string;
  destinationName: string;
  arriveByLocal: string;
  latestDepartLocal?: string;
  estimatedArriveLocal?: string;
  status: string;
  totalMinutes?: number;
  chosenPlanKey?: string;
  mapImageUrl?: string;
  segments: Array<{ id: string; mode: string; title: string; detail: string; minutes: number }>;
  reminderJobs: Array<{ id: string; offsetMinutes: number; status: string; scheduledAt: string }>;
  routeOptions: Array<{ planKey: string; title: string; totalMinutes: number; latestDepartLocal: string; isChosen: boolean }>;
};

export default function TripDetailPage() {
  return (
    <Suspense fallback={null}>
      <TripDetailContent />
    </Suspense>
  );
}

function TripDetailContent() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const backHref = search.get("from") === "history" ? "/history" : "/";

  useEffect(() => {
    apiFetch<{ trip: Trip }>(`/api/trips/${params.id}`)
      .then((data) => setTrip(data.trip))
      .catch((err) => setError(err.message));
  }, [params.id]);

  async function action(path: string, label: string) {
    setBusy(label);
    setError("");
    try {
      const data = await apiFetch<{ trip: Trip }>(path, { method: "POST" });
      setTrip(data.trip);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy("");
    }
  }

  if (!trip) {
    return (
      <AppShell showBottomNav={false}>
        <div className="p-5 pt-14">{error || "加载行程..."}</div>
      </AppShell>
    );
  }

  const routeOptions = trip.routeOptions || [];
  const segments = trip.segments || [];
  const reminderJobs = trip.reminderJobs || [];
  const chosenRoute = routeOptions.find((item) => item.isChosen);

  return (
    <AppShell showBottomNav={false}>
      <header className="flex items-center justify-between bg-[var(--background)] px-4 pb-2 pt-10">
        <Link href={backHref} className="flex h-12 w-12 items-center justify-center rounded-full">
          <Icon name="arrow_back" />
        </Link>
        <h1 className="flex-1 pr-12 text-center text-xl font-extrabold">{trip.destinationName}</h1>
      </header>

      <section className="flex items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-[#e7ebf3]">
            <Icon name="schedule" className="text-[30px]" />
          </span>
          <div>
            <p className="text-xl font-extrabold">{trip.arriveByLocal.slice(11)}</p>
            <p className="text-sm font-medium text-blue-900">
              {statusText(trip.status)} · 预计 {trip.estimatedArriveLocal?.slice(11) || trip.arriveByLocal.slice(11)} 到达
            </p>
          </div>
        </div>
        <span className="h-4 w-4 rounded-full bg-[var(--status-success)]" />
      </section>

      <section className="px-5 py-3">
        <GlassCard className="flex items-stretch justify-between gap-4 rounded-xl bg-white/80 p-4">
          <div className="flex flex-[1.5] flex-col gap-4">
            <div>
              <p className="text-sm text-blue-900">已选方案</p>
              <p className="mt-1 text-lg font-extrabold">{chosenRoute?.title || "最快路线"}</p>
              <p className="mt-2 text-sm leading-6 text-blue-900">
                建议出发时段: {trip.latestDepartLocal?.slice(11) || "--:--"} · 路程约 {trip.totalMinutes || 0} 分钟
              </p>
            </div>
            <button className="flex w-fit items-center gap-2 rounded-lg bg-[#e7ebf3] px-3 py-2 text-sm font-bold">
              查看实时地图 <Icon name="map" className="text-[18px]" />
            </button>
          </div>
          <div
            className="min-h-[136px] flex-1 rounded-xl bg-cover bg-center"
            style={{
              backgroundImage: trip.mapImageUrl
                ? `url(${trip.mapImageUrl})`
                : "linear-gradient(135deg, #d3e4fe, #ffffff 55%, #b7e4f6)"
            }}
          />
        </GlassCard>
      </section>

      <section className="px-5 py-4">
        <h2 className="mb-4 text-2xl font-extrabold">行程拆解</h2>
        <div className="grid grid-cols-[40px_1fr] gap-x-3">
          {segments.map((segment, index) => (
            <TimelineItem key={segment.id || index} segment={segment} isLast={index === segments.length - 1} />
          ))}
        </div>
      </section>

      <section className="space-y-5 px-5 pb-8">
        <div className="flex items-start gap-4 rounded-2xl bg-[var(--tertiary-fixed)] p-5">
          <Icon name="cached" className="mt-1 text-[var(--on-tertiary-fixed)]" />
          <div>
            <p className="font-extrabold text-[var(--on-tertiary-fixed)]">自动复算已开启</p>
            <p className="mt-1 text-sm text-[var(--on-surface-variant)]">按 T-30 / T-20 / T-15 / T-10 / T-5 / T 检查</p>
          </div>
        </div>

        <div>
          <h2 className="mb-4 text-2xl font-extrabold">提醒计划</h2>
          <GlassCard className="divide-y divide-[var(--outline-variant)]/40 rounded-xl bg-white/90 p-4">
            {reminderJobs.slice(-3).map((job) => (
              <div key={job.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <Icon name="notifications_active" className="text-[var(--primary)]" />
                  <span className="font-semibold">{job.offsetMinutes === 0 ? "出发时" : `出发前 ${Math.abs(job.offsetMinutes)} 分钟`}</span>
                </div>
                <span className="text-sm font-semibold text-[var(--on-surface-variant)]">
                  {new Date(job.scheduledAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </GlassCard>
        </div>

        {error ? <p className="text-center text-sm font-semibold text-[var(--error)]">{error}</p> : null}
        <button
          onClick={() => action(`/api/trips/${trip.id}/recheck`, "复算")}
          disabled={Boolean(busy)}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--primary-container)] py-4 text-base font-extrabold text-white shadow-lg shadow-blue-500/20"
        >
          {busy === "复算" ? "复算中" : "手动复算"}
          <Icon name="refresh" className="text-[20px]" />
        </button>
        <button className="w-full rounded-full bg-[var(--secondary-container)] py-4 font-extrabold text-[var(--on-secondary-container)]">
          更改路线
        </button>
        <button
          onClick={() => action(`/api/trips/${trip.id}/cancel`, "停止")}
          disabled={Boolean(busy)}
          className="flex w-full items-center justify-center gap-2 rounded-full py-3 font-extrabold text-[var(--error)]"
        >
          <Icon name="cancel" className="text-[20px]" />
          停止监控
        </button>
      </section>
    </AppShell>
  );
}

function TimelineItem({
  segment,
  isLast
}: {
  segment: { mode: string; title: string; detail: string; minutes: number };
  isLast: boolean;
}) {
  const icon = { walk: "directions_walk", train: "train", bike: "directions_bike", buffer: "hourglass" }[segment.mode] || "route";
  return (
    <>
      <div className="flex flex-col items-center gap-1 pt-1">
        <Icon name={icon} className="text-[26px]" />
        {!isLast ? <div className="h-full min-h-10 w-px bg-[#d0d7e7]" /> : null}
      </div>
      <div className="pb-5">
        <p className="text-lg font-semibold">{segment.title}</p>
        <p className="mt-1 text-base text-blue-900">
          {segment.minutes}分钟 · {segment.detail}
        </p>
      </div>
    </>
  );
}

function statusText(status: string) {
  return status === "cancelled" ? "已取消" : status === "completed" ? "已完成" : "行程正常";
}
