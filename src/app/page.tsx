"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/ui/AppShell";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
import { apiFetch } from "@/lib/client/api";

type Profile = {
  city: string;
  defaultOriginName: string;
};

type Trip = {
  id: string;
  destinationName: string;
  latestDepartLocal?: string;
  totalMinutes?: number;
  chosenPlanKey?: string;
  segments?: Array<{ mode: string; title: string; detail: string; minutes: number }>;
  notifications?: { weather?: string; weatherTemperature?: string };
};

type Memory = {
  id: string;
  label: string;
  value?: { estimateMinutes?: number; name?: string };
};

export default function HomePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [input, setInput] = useState("");
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const draft = window.localStorage.getItem("commute-draft");
    if (draft) setInput(draft);
    Promise.all([
      apiFetch<Profile>("/api/profile"),
      apiFetch<{ trip: Trip | null }>("/api/trips/active"),
      apiFetch<{ memories: Memory[] }>("/api/memories?type=place&status=confirmed"),
      apiFetch<{ memories: Memory[] }>("/api/memories?status=pending")
    ])
      .then(([profileData, activeData, memoryData, pendingData]) => {
        setProfile(profileData);
        setActiveTrip(activeData.trip);
        setMemories(memoryData.memories.slice(0, 4));
        setPendingCount(pendingData.memories.length);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    window.localStorage.setItem("commute-draft", input);
  }, [input]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    setPlanning(true);
    setError("");
    try {
      const result = await apiFetch<{ tripId: string | null; message: string; state: string; pendingMemoryCount: number }>(
        "/api/agent/messages",
        {
          method: "POST",
          body: JSON.stringify({ text: input, source: "web" })
        }
      );
      setPendingCount(result.pendingMemoryCount);
      if (result.tripId) {
        window.localStorage.removeItem("commute-draft");
        window.location.href = `/trips/${result.tripId}`;
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "规划失败");
    } finally {
      setPlanning(false);
    }
  }

  const weather = activeTrip?.notifications?.weather || "稍后有小雨";
  const temperature = activeTrip?.notifications?.weatherTemperature || "24";
  const nextStep = useMemo(() => activeTrip?.segments?.[0]?.title || "等待下一次规划", [activeTrip]);

  return (
    <AppShell>
      <header className="px-5 pb-6 pt-12">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center text-[var(--on-surface-variant)]">
              <Icon name="location_on" fill className="mr-1 text-[22px]" />
              <span className="text-sm font-semibold uppercase tracking-wide">当前位置</span>
            </div>
            <h1 className="mt-1 text-4xl font-extrabold tracking-normal">{profile?.city || "宁波"}</h1>
          </div>
          <GlassCard className="flex items-center gap-3 rounded-2xl px-4 py-3">
            <Icon name="partly_cloudy_day" fill className="text-[30px] text-[var(--status-warning)]" />
            <div>
              <div className="text-lg font-bold">{temperature}°C</div>
              <div className="text-xs font-medium text-[var(--on-surface-variant)]">{weather}</div>
            </div>
          </GlassCard>
        </div>
      </header>

      <section className="px-5">
        <form onSubmit={submit} className="relative py-8">
          <Icon
            name="search"
            className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[32px] text-[var(--outline-variant)]"
          />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={planning}
            className="focus-ring w-full rounded-full border-0 bg-[var(--surface-container-low)] py-6 pl-16 pr-20 text-xl font-semibold text-[var(--on-surface)] shadow-sm outline-none transition placeholder:text-[var(--outline)] focus:bg-white"
            placeholder="你想去哪儿？"
          />
          <button
            type="button"
            onClick={() => setError("语音输入稍后支持")}
            className="absolute right-3 top-1/2 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full text-[var(--primary)] transition hover:bg-blue-50"
            aria-label="语音输入"
          >
            <Icon name="mic" fill className="mic-ripple rounded-full" />
          </button>
          <p className="mt-4 text-center text-sm font-medium text-[var(--on-surface-variant)]">
            {planning ? "Agent 正在理解需求、定位目的地、计算路线、设置提醒" : "点击麦克风或输入目的地"}
          </p>
          {error ? <p className="mt-4 text-center text-sm font-semibold text-[var(--error)]">{error}</p> : null}
        </form>
      </section>

      <section className="space-y-6 px-5">
        {activeTrip ? (
          <GlassCard as={Link} href={`/trips/${activeTrip.id}`} className="block p-6">
            <div className="flex items-center justify-between">
              <StatusPill>进行中的行程</StatusPill>
              <span className="text-lg font-extrabold text-[var(--primary)]">{activeTrip.totalMinutes || 0} 分钟</span>
            </div>
            <h2 className="mt-6 text-3xl font-extrabold tracking-normal">{activeTrip.destinationName}</h2>
            <p className="mt-2 text-lg font-medium text-[var(--on-surface-variant)]">下一步：{nextStep}</p>
            <div className="mt-6 flex items-center justify-between border-t border-[var(--outline-variant)]/40 pt-5">
              <div className="flex -space-x-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-[var(--surface-container)]">
                  <Icon name="directions_walk" className="text-[20px]" />
                </span>
                <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-[var(--primary-container)] text-white">
                  <Icon name="train" className="text-[20px]" />
                </span>
              </div>
              <span className="rounded-full bg-[var(--primary-container)] px-5 py-3 text-sm font-bold text-white">查看详情</span>
            </div>
          </GlassCard>
        ) : (
          <GlassCard className="p-5">
            <p className="text-base font-semibold">暂无活跃行程</p>
            <p className="mt-1 text-sm text-[var(--on-surface-variant)]">输入一句话即可创建新的通勤提醒。</p>
          </GlassCard>
        )}

        {pendingCount > 0 ? (
          <GlassCard className="flex items-center justify-between p-4">
            <div>
              <p className="font-bold">发现 {pendingCount} 条待确认偏好</p>
              <p className="text-sm text-[var(--on-surface-variant)]">确认后才会参与路线规划</p>
            </div>
            <Link href="/settings#pending-memory" className="rounded-full bg-[var(--secondary-container)] px-4 py-2 text-sm font-bold">
              查看
            </Link>
          </GlassCard>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          {memories.map((memory) => (
            <button
              key={memory.id}
              onClick={() => setInput(`明天 9:15 到${memory.value?.name || memory.label}`)}
              className="glass-card rounded-2xl p-5 text-left"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--secondary-container)] text-[var(--on-secondary-container)]">
                <Icon name={memory.label.includes("公司") ? "work" : "home_work"} />
              </span>
              <span className="mt-4 block text-lg font-extrabold">{memory.label}</span>
              <span className="mt-1 block text-base text-[var(--on-surface-variant)]">{memory.value?.estimateMinutes || 20} 分钟</span>
            </button>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
