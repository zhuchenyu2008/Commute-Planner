"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });

    setIsSubmitting(false);

    if (!response.ok) {
      setError("邮箱或密码不正确");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="email">
          邮箱
        </label>
        <input
          autoComplete="email"
          className="w-full rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-base text-slate-950 outline-none ring-sky-500/30 transition focus:ring-4"
          id="email"
          name="email"
          required
          type="email"
        />
      </div>

      <div className="space-y-2">
        <label
          className="text-sm font-medium text-slate-700"
          htmlFor="password"
        >
          密码
        </label>
        <input
          autoComplete="current-password"
          className="w-full rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-base text-slate-950 outline-none ring-sky-500/30 transition focus:ring-4"
          id="password"
          name="password"
          required
          type="password"
        />
      </div>

      {error ? (
        <p className="text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <button
        className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting}
        type="submit"
      >
        登录
      </button>
    </form>
  );
}
