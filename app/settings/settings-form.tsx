"use client";

import { FormEvent, useState } from "react";

type SettingsValues = {
  defaultCity: string;
  timezone: string;
  originName: string;
  originLngLat: string;
  routePreference: string;
  telegramChatId: string;
  emailRecipient: string;
};

const fields = [
  ["defaultCity", "默认城市"],
  ["timezone", "时区"],
  ["originName", "出发地名称"],
  ["originLngLat", "出发地坐标"],
  ["routePreference", "路线偏好"],
  ["telegramChatId", "Telegram Chat ID"],
  ["emailRecipient", "邮件接收人"]
] as const;

export function SettingsForm({ values }: { values: SettingsValues }) {
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData.entries()))
    });

    setIsSubmitting(false);
    setStatus(response.ok ? "已保存" : "保存失败");
  }

  return (
    <form
      className="glass-card rounded-2xl p-6 shadow-xl shadow-slate-200/70"
      onSubmit={onSubmit}
    >
      <div className="divide-y divide-outline-variant/70">
        {fields.map(([name, label]) => (
          <label
            className="grid gap-2 py-4 md:grid-cols-[160px_1fr] md:items-center"
            htmlFor={name}
            key={name}
          >
            <span className="text-sm font-medium text-on-surface-variant">
              {label}
            </span>
            <input
              className="w-full rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-base text-on-surface outline-none ring-primary/20 transition focus:ring-4"
              id={name}
              name={name}
              defaultValue={values[name]}
            />
          </label>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-on-surface-variant" role="status">
          {status}
        </p>
        <button
          className="rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={isSubmitting}
        >
          保存
        </button>
      </div>
    </form>
  );
}
