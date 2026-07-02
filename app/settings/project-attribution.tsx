"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { AUTHOR_NAME, REPOSITORY_URL } from "@/lib/project";
import { credits } from "./credits";

const englishSegmentPattern = /([A-Za-z0-9][A-Za-z0-9 /.-]*[A-Za-z0-9]|[A-Za-z0-9])/g;

function renderHandwrittenText(text: string) {
  const segments = text.split(englishSegmentPattern).filter(Boolean);

  return segments.map((segment, index) => {
    const isEnglishSegment = /^[A-Za-z0-9][A-Za-z0-9 /.-]*[A-Za-z0-9]$|^[A-Za-z0-9]$/.test(
      segment
    );

    return (
      <span
        className={
          isEnglishSegment
            ? "font-handwriting-en text-[0.86em]"
            : "font-handwriting-cn text-[1.18em]"
        }
        key={`${segment}-${index}`}
      >
        {segment}
      </span>
    );
  });
}

export function ProjectAttribution() {
  const [isCreditsOpen, setIsCreditsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const creditsDialog = isCreditsOpen ? (
    <div
      aria-labelledby="credits-title"
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-[#191c1e]/35 px-5 py-6 backdrop-blur-sm"
      role="dialog"
    >
      <div className="max-h-[calc(100dvh-3rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-white/70 bg-white/95 p-6 shadow-2xl shadow-slate-900/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#2563eb]">AI Commute</p>
            <h2
              className="mt-1 text-2xl font-semibold text-on-surface"
              id="credits-title"
            >
              致谢名单
            </h2>
          </div>
          <button
            aria-label="关闭致谢名单"
            className="inline-flex size-9 items-center justify-center rounded-full bg-[#f2f4f6] text-[#434655] transition hover:bg-[#dae2fd] hover:text-[#1d3d7c]"
            onClick={() => setIsCreditsOpen(false)}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div
          className="font-handwriting mt-5 space-y-4 text-lg leading-8 text-[#2f3340]"
          data-testid="credits-handwriting"
        >
          <div className="space-y-3">
            {credits.map((credit) => (
              <div
                className="rounded-2xl bg-[#f7f9fb] px-4 py-3"
                key={`${credit.name}-${credit.note}`}
              >
                <p className="text-2xl font-normal text-[#191c1e]">
                  {renderHandwrittenText(credit.name)}
                </p>
                <p className="mt-1 text-base text-[#434655]">
                  {renderHandwrittenText(credit.note)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="glass-card flex flex-col gap-3 rounded-2xl p-5 text-sm text-on-surface-variant shadow-lg shadow-slate-200/60 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-on-surface">项目署名</p>
          <p className="mt-1">Created by {AUTHOR_NAME}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            className="inline-flex items-center justify-center rounded-2xl bg-[#dae2fd] px-4 py-2 font-semibold text-[#1d3d7c] transition hover:bg-[#bec6e0]"
            href={REPOSITORY_URL}
            rel="noreferrer"
            target="_blank"
          >
            GitHub 仓库
          </a>
          <button
            className="inline-flex items-center justify-center rounded-2xl bg-[#dae2fd] px-4 py-2 font-semibold text-[#1d3d7c] transition hover:bg-[#bec6e0]"
            onClick={() => setIsCreditsOpen(true)}
            type="button"
          >
            致谢名单
          </button>
        </div>
      </div>

      {isMounted && creditsDialog
        ? createPortal(creditsDialog, document.body)
        : null}
    </>
  );
}
