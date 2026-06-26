"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  status: string;
  routeType: string;
  totalMinutes?: number;
  chosenPlanKey?: string;
};

export default function HistoryPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status !== "all") params.set("status", status);
    apiFetch<{ trips: Trip[] }>(`/api/trips?${params.toString()}`)
      .then((data) => setTrips(data.trips))
      .catch((err) => setError(err.message));
  }, [q, status]);

  const upcoming = useMemo(() => trips.filter((trip) => ["active", "scheduled"].includes(trip.status)), [trips]);
  const past = useMemo(() => trips.filter((trip) => !["active", "scheduled"].includes(trip.status)), [trips]);

  return (
    <AppShell>
      <header className="px-5 pb-4 pt-12">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-normal">历史记录</h1>
            <p className="mt-1 text-base text-[var(--on-surface-variant)]">查看过去的路线和提醒</p>
          </div>
          <button className="flex h-12 w-12 items-center justify-center rounded-full bg-white/70 text-[var(--on-surface-variant)]">
            <Icon name="delete_sweep" />
          </button>
        </div>
      </header>

      <section className="space-y-4 px-5">
        <div className="relative">
          <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--outline)]" />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className="focus-ring w-full rounded-full border-0 bg-[var(--surface-container-low)] py-4 pl-12 pr-4 outline-none"
            placeholder="目的地、地点别名、路线名"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[
            ["all", "全部"],
            ["active,scheduled", "进行中/未来"],
            ["completed", "已完成"],
            ["cancelled", "已取消"]
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setStatus(value)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${
                status === value ? "bg-[var(--primary-container)] text-white" : "bg-white/70 text-[var(--on-surface-variant)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {error ? <p className="text-sm font-semibold text-[var(--error)]">{error}</p> : null}
      </section>

      <TripSection title="当前/未来行程" trips={upcoming} emptyText="暂无当前或未来行程" />
      <TripSection title="历史行程" trips={past} emptyText="还没有历史记录" />
    </AppShell>
  );
}

function TripSection({ title, trips, emptyText }: { title: string; trips: Trip[]; emptyText: string }) {
  return (
    <section className="mt-8 px-5">
      <h2 className="mb-3 text-xl font-extrabold">{title}</h2>
      {trips.length === 0 ? (
        <GlassCard className="p-5 text-sm text-[var(--on-surface-variant)]">{emptyText}</GlassCard>
      ) : (
        <div className="space-y-3">
          {trips.map((trip) => (
            <GlassCard key={trip.id} as={Link} href={`/trips/${trip.id}?from=history`} className="block p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-extrabold">{trip.destinationName}</h3>
                  <p className="mt-1 text-sm text-[var(--on-surface-variant)]">
                    {trip.arriveByLocal} 到达 · 最晚 {trip.latestDepartLocal?.slice(11) || "--:--"} 出发
                  </p>
                  <p className="mt-1 text-sm text-[var(--on-surface-variant)]">{trip.chosenPlanKey || "路线未锁定"}</p>
                </div>
                <StatusPill tone={trip.status === "cancelled" ? "error" : trip.status === "completed" ? "neutral" : "success"}>
                  {statusLabel(trip.status)}
                </StatusPill>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </section>
  );
}

function statusLabel(status: string) {
  return (
    {
      active: "进行中",
      scheduled: "未来",
      completed: "已完成",
      cancelled: "已取消",
      deleted: "已删除"
    }[status] || status
  );
}
