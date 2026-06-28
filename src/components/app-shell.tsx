import Link from "next/link";
import { MapPin } from "lucide-react";
import { BottomNav, type NavKey } from "@/components/bottom-nav";

const desktopItems = [
  { key: "home", href: "/", label: "首页" },
  { key: "history", href: "/history", label: "历史" },
  { key: "memories", href: "/memories", label: "记忆" },
  { key: "settings", href: "/settings", label: "设置" },
] as const;

export function AppShell({
  active,
  children,
}: {
  active: NavKey;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#f7f9fb] text-[#191c1e]">
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_0_18%,rgba(195,198,215,0.45)_18.2%,transparent_18.8%_44%,rgba(195,198,215,0.34)_44.2%,transparent_44.8%_100%),linear-gradient(24deg,transparent_0_28%,rgba(180,197,255,0.36)_28.2%,transparent_28.8%_72%,rgba(195,198,215,0.28)_72.2%,transparent_72.8%_100%),linear-gradient(90deg,transparent_0_8%,rgba(211,228,254,0.5)_8.2%_12%,transparent_12.2%_100%)]" />
        <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent_0_54px,rgba(195,198,215,0.28)_55px,transparent_57px),repeating-linear-gradient(90deg,transparent_0_78px,rgba(195,198,215,0.22)_79px,transparent_81px)]" />
        <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-[#f7f9fb] to-transparent" />
      </div>

      <header className="fixed inset-x-0 top-0 z-40 hidden border-b border-white/60 bg-white/70 backdrop-blur-md md:block">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link className="flex items-center gap-2 font-bold text-[#191c1e]" href="/">
            <MapPin aria-hidden="true" className="size-5 text-[#2563eb]" />
            <span>通勤规划助手</span>
          </Link>
          <nav aria-label="桌面导航" className="flex items-center gap-7">
            {desktopItems.map((item) => (
              <Link
                className={`border-b-2 pb-1 text-sm font-semibold transition ${
                  active === item.key
                    ? "border-[#2563eb] text-[#2563eb]"
                    : "border-transparent text-[#434655] hover:text-[#2563eb]"
                }`}
                href={item.href}
                key={item.key}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-[104px] pt-8 md:px-6 md:pb-12 md:pt-24">
        {children}
      </main>
      <BottomNav active={active} />
    </div>
  );
}
