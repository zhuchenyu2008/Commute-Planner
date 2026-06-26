"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "@/components/ui/AppShell";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
import { apiFetch } from "@/lib/client/api";

type Profile = {
  city: string;
  timezone: string;
  defaultOriginName: string;
  defaultOriginAddress: string;
  defaultOriginLngLat: string;
};

type Memory = {
  id: string;
  type: string;
  status: string;
  label: string;
  sourceText?: string;
  confidence?: number;
  value?: Record<string, unknown>;
};

type Status = {
  amap: boolean;
  model: boolean;
  telegram: boolean;
  smtp: boolean;
  databaseUrl: string;
  appVersion: string;
};

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([
      apiFetch<Profile>("/api/profile"),
      apiFetch<{ memories: Memory[] }>("/api/memories"),
      apiFetch<Status>("/api/settings/status")
    ]).then(([profileData, memoryData, statusData]) => {
      setProfile(profileData);
      setMemories(memoryData.memories);
      setStatus(statusData);
    });
  }, []);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;
    const saved = await apiFetch<Profile>("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({
        city: profile.city,
        timezone: profile.timezone,
        defaultOriginName: profile.defaultOriginName,
        defaultOriginAddress: profile.defaultOriginAddress,
        defaultOriginLngLat: profile.defaultOriginLngLat
      })
    });
    setProfile(saved);
    setMessage("基础资料已保存");
  }

  async function confirmMemory(memory: Memory) {
    const data = await apiFetch<{ memory: Memory }>(`/api/memories/${memory.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setMemories((items) => items.map((item) => (item.id === memory.id ? data.memory : item)));
  }

  async function ignoreMemory(memory: Memory) {
    const data = await apiFetch<{ memory: Memory }>(`/api/memories/${memory.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "ignored" })
    });
    setMemories((items) => items.map((item) => (item.id === memory.id ? data.memory : item)));
  }

  async function testNotification(channel: "telegram" | "email") {
    const data = await apiFetch<{ result: { status: string; error?: string } }>("/api/settings/test-notification", {
      method: "POST",
      body: JSON.stringify({ channel })
    });
    setMessage(`${channel === "telegram" ? "Telegram" : "邮件"}：${data.result.status}${data.result.error ? ` · ${data.result.error}` : ""}`);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const pending = memories.filter((memory) => memory.status === "pending");
  const places = memories.filter((memory) => memory.type === "place" && memory.status === "confirmed");

  return (
    <AppShell>
      <header className="px-5 pb-4 pt-12">
        <h1 className="text-3xl font-extrabold tracking-normal">设置</h1>
        <p className="mt-1 text-base text-[var(--on-surface-variant)]">管理偏好、记忆和通知</p>
      </header>

      <div className="space-y-6 px-5">
        <GlassCard className="p-5">
          <SectionTitle icon="shield_lock" title="账号与安全" />
          <div className="mt-4 flex items-center justify-between">
            <div>
              <p className="font-bold">当前网页登录已启用</p>
              <p className="text-sm text-[var(--on-surface-variant)]">Session 过期后会回到登录页</p>
            </div>
            <button onClick={logout} className="rounded-full bg-[var(--surface-container-low)] px-4 py-2 text-sm font-bold">
              退出
            </button>
          </div>
        </GlassCard>

        {profile ? (
          <GlassCard className="p-5">
            <SectionTitle icon="person_pin_circle" title="基础资料" />
            <form onSubmit={saveProfile} className="mt-4 space-y-4">
              <SettingsInput label="默认城市" value={profile.city} onChange={(value) => setProfile({ ...profile, city: value })} />
              <SettingsInput label="时区" value={profile.timezone} onChange={(value) => setProfile({ ...profile, timezone: value })} />
              <SettingsInput
                label="默认起点"
                value={profile.defaultOriginAddress}
                onChange={(value) => setProfile({ ...profile, defaultOriginAddress: value })}
              />
              <SettingsInput
                label="起点经纬度"
                value={profile.defaultOriginLngLat}
                onChange={(value) => setProfile({ ...profile, defaultOriginLngLat: value })}
              />
              <button className="rounded-full bg-[var(--primary-container)] px-5 py-3 font-bold text-white">保存资料</button>
            </form>
          </GlassCard>
        ) : null}

        <GlassCard id="pending-memory" className="p-5">
          <SectionTitle icon="psychology_alt" title="待确认记忆" />
          <div className="mt-4 space-y-3">
            {pending.length === 0 ? (
              <p className="text-sm text-[var(--on-surface-variant)]">暂无待确认偏好</p>
            ) : (
              pending.map((memory) => (
                <div key={memory.id} className="rounded-xl bg-white/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-bold">{memory.label}</p>
                      <p className="mt-1 text-sm text-[var(--on-surface-variant)]">{memory.sourceText}</p>
                    </div>
                    <StatusPill tone="warning">{Math.round((memory.confidence || 0.7) * 100)}%</StatusPill>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => confirmMemory(memory)} className="rounded-full bg-[var(--primary-container)] px-4 py-2 text-sm font-bold text-white">
                      确认
                    </button>
                    <button onClick={() => ignoreMemory(memory)} className="rounded-full bg-[var(--surface-container-low)] px-4 py-2 text-sm font-bold">
                      忽略
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <SectionTitle icon="map" title="地点与别名" />
          <div className="mt-4 space-y-3">
            {places.map((memory) => (
              <div key={memory.id} className="flex items-center justify-between rounded-xl bg-white/70 p-4">
                <div>
                  <p className="font-bold">{memory.label}</p>
                  <p className="text-sm text-[var(--on-surface-variant)]">{String(memory.value?.address || memory.value?.name || "已确认地点")}</p>
                </div>
                <Icon name="chevron_right" className="text-[var(--outline)]" />
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <SectionTitle icon="tune" title="路线偏好" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            {["偏好地铁", "少走路", "少换乘", "允许共享单车", "避免打车", "雨天降低骑行"].map((label) => (
              <label key={label} className="flex items-center gap-3 rounded-xl bg-white/70 p-3 text-sm font-semibold">
                <input type="checkbox" defaultChecked={label !== "避免打车"} className="h-4 w-4 accent-[var(--primary-container)]" />
                {label}
              </label>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <SectionTitle icon="notifications" title="通知设置" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              disabled={!status?.telegram}
              onClick={() => testNotification("telegram")}
              className="rounded-full bg-[var(--secondary-container)] px-4 py-3 text-sm font-bold disabled:opacity-50"
            >
              测试 Telegram
            </button>
            <button
              disabled={!status?.smtp}
              onClick={() => testNotification("email")}
              className="rounded-full bg-[var(--secondary-container)] px-4 py-3 text-sm font-bold disabled:opacity-50"
            >
              测试邮件
            </button>
          </div>
          <p className="mt-3 text-sm text-[var(--on-surface-variant)]">提醒节奏：T-30、T-20、T-15、T-10、T-5、T。</p>
        </GlassCard>

        <GlassCard className="p-5">
          <SectionTitle icon="dns" title="系统配置状态" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <ConfigItem label="高德 Web Key" ok={Boolean(status?.amap)} />
            <ConfigItem label="模型" ok={Boolean(status?.model)} />
            <ConfigItem label="Telegram" ok={Boolean(status?.telegram)} />
            <ConfigItem label="SMTP" ok={Boolean(status?.smtp)} />
          </div>
          <p className="mt-4 text-sm text-[var(--on-surface-variant)]">数据库：{status?.databaseUrl || "data/commute.db"}</p>
        </GlassCard>

        {message ? <p className="pb-4 text-center text-sm font-semibold text-[var(--primary)]">{message}</p> : null}
      </div>
    </AppShell>
  );
}

function SectionTitle({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon name={icon} className="text-[var(--primary)]" />
      <h2 className="text-xl font-extrabold">{title}</h2>
    </div>
  );
}

function SettingsInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-[var(--on-surface-variant)]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border-0 bg-white/80 px-4 py-3 outline-none"
      />
    </label>
  );
}

function ConfigItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="rounded-xl bg-white/70 p-3">
      <p className="text-sm font-bold">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${ok ? "text-emerald-600" : "text-amber-600"}`}>{ok ? "已配置" : "未配置"}</p>
    </div>
  );
}
