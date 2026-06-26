export function StatusPill({
  tone = "success",
  children
}: {
  tone?: "success" | "warning" | "error" | "neutral";
  children: React.ReactNode;
}) {
  const classes = {
    success: "bg-emerald-500/10 text-emerald-600",
    warning: "bg-amber-500/10 text-amber-600",
    error: "bg-red-500/10 text-red-600",
    neutral: "bg-slate-500/10 text-slate-600"
  }[tone];
  const dot = {
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    error: "bg-red-500",
    neutral: "bg-slate-400"
  }[tone];

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${classes}`}>
      <span className={`mr-2 h-2 w-2 rounded-full ${dot}`} />
      {children}
    </span>
  );
}
