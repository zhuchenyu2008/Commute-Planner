"use client";

import { FormEvent, useState } from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/ui/AppShell";
import { Icon } from "@/components/ui/Icon";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const search = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.message || "登录失败");
      setLoading(false);
      return;
    }
    window.location.href = search.get("next") || "/";
  }

  return (
    <AppShell showBottomNav={false}>
      <div className="flex min-h-dvh items-center px-5 py-10">
        <form onSubmit={submit} className="glass-card w-full rounded-2xl p-6">
          <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary-container)] text-white">
            <Icon name="lock" fill />
          </div>
          <h1 className="text-3xl font-bold tracking-normal text-[var(--on-surface)]">通勤助手</h1>
          <p className="mt-2 text-base leading-6 text-[var(--on-surface-variant)]">输入网页登录密码后继续。</p>
          <label className="mt-8 block text-sm font-semibold text-[var(--on-surface-variant)]">密码</label>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoFocus
            className="focus-ring mt-2 w-full rounded-full border-0 bg-[var(--surface-container-low)] px-5 py-4 text-lg outline-none transition focus:bg-white"
            placeholder="请输入密码"
          />
          {error ? <p className="mt-3 text-sm font-semibold text-[var(--error)]">{error}</p> : null}
          <button
            disabled={loading}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--primary-container)] px-5 py-4 text-base font-bold text-white shadow-lg shadow-blue-500/20 disabled:opacity-60"
          >
            {loading ? "登录中" : "进入"}
            <Icon name="arrow_forward" className="text-[20px]" />
          </button>
        </form>
      </div>
    </AppShell>
  );
}
