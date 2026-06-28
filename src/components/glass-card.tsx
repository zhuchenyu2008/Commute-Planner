import type { ComponentPropsWithoutRef } from "react";

type GlassCardProps = ComponentPropsWithoutRef<"div">;

export function GlassCard({ className = "", ...props }: GlassCardProps) {
  return (
    <div
      className={`glass-card rounded-2xl shadow-sm shadow-slate-200/70 ${className}`}
      {...props}
    />
  );
}
