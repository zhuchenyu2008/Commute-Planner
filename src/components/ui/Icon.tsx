export function Icon({
  name,
  className,
  fill = false
}: {
  name: string;
  className?: string;
  fill?: boolean;
}) {
  return (
    <span
      className={`material-symbols-outlined ${className || ""}`}
      style={{ fontVariationSettings: fill ? '"FILL" 1' : '"FILL" 0' }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
