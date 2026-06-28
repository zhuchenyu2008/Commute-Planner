import React from "react";
import { Bike, Building2, Bus, Footprints, MapPin, Train } from "lucide-react";

export type RouteTimelineSegment = {
  id?: string;
  mode: string;
  title: string;
  detail?: string | null;
  minutes: number;
};

export type RouteTimelineGroup = {
  id?: string;
  title: string;
  subtitle?: string | null;
  segments: RouteTimelineSegment[];
};

function SegmentIcon({ mode }: { mode: string }) {
  const normalized = mode.toLowerCase();

  if (normalized.includes("train") || normalized.includes("metro")) {
    return <Train aria-hidden="true" className="size-5" />;
  }
  if (normalized.includes("bus") || normalized.includes("transit")) {
    return <Bus aria-hidden="true" className="size-5" />;
  }
  if (normalized.includes("bike") || normalized.includes("cycle")) {
    return <Bike aria-hidden="true" className="size-5" />;
  }
  if (normalized.includes("arrive") || normalized.includes("destination")) {
    return <Building2 aria-hidden="true" className="size-5" />;
  }
  if (normalized.includes("walk")) {
    return <Footprints aria-hidden="true" className="size-5" />;
  }
  return <MapPin aria-hidden="true" className="size-5" />;
}

export function RouteTimeline({
  groups,
  segments,
}: {
  groups?: RouteTimelineGroup[];
  segments?: RouteTimelineSegment[];
}) {
  const groupedSegments =
    groups && groups.length > 0
      ? groups
      : [{ title: "", segments: segments ?? [] }];
  const hasSegments = groupedSegments.some((group) => group.segments.length > 0);

  if (!hasSegments) {
    return (
      <p className="rounded-2xl bg-white/60 px-4 py-5 text-sm font-medium text-[#434655]">
        智能体完成规划后会显示路线分段。
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {groupedSegments.map((group, groupIndex) => {
        const visibleSegments = group.segments;

        return (
          <section
            className="space-y-2"
            key={group.id ?? `${group.title}-${groupIndex}`}
          >
            {group.title ? (
              <div className="rounded-2xl bg-white/55 px-4 py-3">
                <p className="break-words text-sm font-bold text-[#191c1e]">
                  {group.title}
                </p>
                {group.subtitle ? (
                  <p className="mt-1 break-words text-xs font-semibold uppercase tracking-[0.05em] text-[#434655]">
                    {group.subtitle}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="grid grid-cols-[40px_1fr] gap-x-2">
              {visibleSegments.map((segment, index) => {
                const isLast = index === visibleSegments.length - 1;

                return (
                  <div
                    className="contents"
                    key={segment.id ?? `${segment.title}-${index}`}
                  >
                    <div className="flex flex-col items-center gap-1 pt-3">
                      {index > 0 && <div className="h-2 w-px bg-[#c3c6d7]" />}
                      <div className="flex size-9 items-center justify-center rounded-xl bg-[#f2f4f6] text-[#191c1e]">
                        <SegmentIcon mode={segment.mode} />
                      </div>
                      {!isLast && (
                        <div className="min-h-6 w-px grow bg-[#c3c6d7]" />
                      )}
                    </div>
                    <div className="min-w-0 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="break-words text-base font-semibold text-[#191c1e]">
                          {segment.title}
                        </p>
                        <span className="shrink-0 rounded-full bg-[#dae2fd] px-2.5 py-1 text-xs font-bold text-[#3f465c]">
                          {segment.minutes} 分钟
                        </span>
                      </div>
                      {segment.detail ? (
                        <p className="mt-1 break-words text-sm leading-6 text-[#434655]">
                          {segment.detail}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
