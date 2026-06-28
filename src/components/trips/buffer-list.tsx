import React from "react";
import { CloudSun, ShieldCheck } from "lucide-react";

export type BufferListItem = {
  id?: string;
  category: string;
  label: string;
  minutes: number;
  reason: string;
  source?: string | null;
};

function isWeatherBuffer(buffer: BufferListItem) {
  return (
    buffer.category.toLowerCase().includes("weather") ||
    buffer.source === "weather_context"
  );
}

export function BufferList({ buffers }: { buffers: BufferListItem[] }) {
  if (buffers.length === 0) {
    return (
      <p className="rounded-2xl bg-white/60 px-4 py-5 text-sm font-medium text-[#434655]">
        暂无缓冲项目。智能体会在条件需要时补充缓冲。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {buffers.map((buffer, index) => {
        const weather = isWeatherBuffer(buffer);
        const Icon = weather ? CloudSun : ShieldCheck;

        return (
          <div
            className="flex items-start justify-between gap-4 rounded-2xl bg-white/65 p-4 shadow-sm"
            key={buffer.id ?? `${buffer.label}-${index}`}
          >
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                  weather
                    ? "bg-[#d3e4fe] text-[#38485d]"
                    : "bg-[#dae2fd] text-[#2563eb]"
                }`}
              >
                <Icon aria-hidden="true" className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="break-words text-sm font-bold text-[#191c1e]">
                  {buffer.label}
                </p>
                <p className="mt-1 break-words text-sm leading-5 text-[#434655]">
                  {buffer.reason}
                </p>
                {weather ? (
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.05em] text-[#565e74]">
                    仅作天气参考
                  </p>
                ) : null}
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-[#f2f4f6] px-3 py-1 text-xs font-bold text-[#191c1e]">
              {buffer.minutes} 分钟
            </span>
          </div>
        );
      })}
    </div>
  );
}
