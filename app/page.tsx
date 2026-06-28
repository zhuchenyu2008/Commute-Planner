import Link from "next/link";
import { CloudSun, MapPin, Navigation, Sparkles } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { GlassCard } from "@/components/glass-card";
import { CommuteInput } from "@/components/home/commute-input";

export default function HomePage() {
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
              规划一次通勤
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
          <GlassCard className="p-6">
            <div className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center rounded-full bg-[#10B981]/10 px-3 py-1 text-xs font-bold text-[#10B981]">
                就绪
              </span>
              <span className="text-sm font-bold text-[#2563eb]">
                智能体辅助
              </span>
            </div>
            <div className="mt-5 space-y-2">
              <h2 className="text-2xl font-semibold text-[#191c1e]">
                告诉智能体你要去哪、几点到。
              </h2>
              <p className="text-sm leading-6 text-[#434655]">
                它会创建行程、计算缓冲、安排提醒，并持续监控路线状态。
              </p>
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-[#c3c6d7]/50 pt-4">
              <div className="flex -space-x-2">
                <div className="flex size-9 items-center justify-center rounded-full border-2 border-white bg-[#f2f4f6] text-[#434655]">
                  <Navigation aria-hidden="true" className="size-4" />
                </div>
                <div className="flex size-9 items-center justify-center rounded-full border-2 border-white bg-[#2563eb] text-white">
                  <Sparkles aria-hidden="true" className="size-4" />
                </div>
              </div>
              <Link
                className="rounded-full bg-[#2563eb] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#004ac6]"
                href="/history"
              >
                查看历史
              </Link>
            </div>
          </GlassCard>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-1">
            <GlassCard className="p-4">
              <p className="text-sm font-bold text-[#191c1e]">出发点</p>
              <p className="mt-1 text-xs font-medium text-[#434655]">
                使用已保存的位置
              </p>
            </GlassCard>
            <GlassCard className="p-4">
              <p className="text-sm font-bold text-[#191c1e]">通勤记忆</p>
              <p className="mt-1 text-xs font-medium text-[#434655]">
                确认地点和偏好
              </p>
            </GlassCard>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
