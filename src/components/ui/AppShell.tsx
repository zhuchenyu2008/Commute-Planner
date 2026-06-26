"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

const navItems = [
  { href: "/", icon: "home", label: "首页" },
  { href: "/history", icon: "history", label: "历史" },
  { href: "/settings", icon: "settings", label: "设置" }
];

export function AppShell({
  children,
  showBottomNav = true,
  mapImageUrl
}: {
  children: React.ReactNode;
  showBottomNav?: boolean;
  mapImageUrl?: string;
}) {
  return (
    <div className="min-h-dvh bg-[var(--background)]">
      {mapImageUrl ? (
        <div
          className="fixed inset-0 z-0 opacity-40 pointer-events-none bg-center bg-cover"
          style={{ backgroundImage: `url(${mapImageUrl})` }}
        />
      ) : (
        <div className="map-backdrop" />
      )}
      <main className={`app-workbench relative z-10 ${showBottomNav ? "safe-bottom" : ""}`}>{children}</main>
      {showBottomNav ? <BottomNav /> : null}
    </div>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/30 bg-white/70 backdrop-blur-md bottom-nav md:hidden">
      <div className="mx-auto flex w-full max-w-[760px] items-center justify-around px-8 py-3">
        {navItems.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary-container)] text-white shadow-lg shadow-blue-500/20"
                  : "flex h-14 w-14 items-center justify-center rounded-full text-[var(--on-surface-variant)] transition hover:text-[var(--primary)]"
              }
            >
              <Icon name={item.icon} fill={active} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
