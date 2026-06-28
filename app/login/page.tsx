import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-12">
      <section className="glass-card w-full max-w-md rounded-2xl p-7 shadow-xl shadow-slate-200/70">
        <div className="mb-8 space-y-2">
          <p className="text-sm font-medium text-slate-500">通勤规划助手</p>
          <h1 className="text-3xl font-semibold text-slate-950">登录</h1>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
