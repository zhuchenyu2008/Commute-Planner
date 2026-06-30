"use client";

import React from "react";

type HistoryDateFilterProps = {
  value: string;
};

export function HistoryDateFilter({ value }: HistoryDateFilterProps) {
  return (
    <form className="mt-4 flex flex-wrap items-center gap-3" action="/history">
      <label
        className="text-sm font-semibold text-[#434655]"
        htmlFor="history-date"
      >
        查看日期
      </label>
      <input
        aria-label="查看日期"
        className="rounded-2xl border border-white/70 bg-white/80 px-4 py-2 text-sm font-semibold text-[#191c1e] outline-none ring-primary/20 transition focus:ring-4"
        defaultValue={value}
        id="history-date"
        name="date"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        type="date"
      />
    </form>
  );
}
