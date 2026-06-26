import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type GlassCardProps<T extends ElementType> = {
  children: ReactNode;
  className?: string;
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

export function GlassCard<T extends ElementType = "div">({
  children,
  className = "",
  as,
  ...props
}: GlassCardProps<T>) {
  const Component = as || "div";
  return (
    <Component className={`glass-card rounded-2xl ${className}`} {...props}>
      {children}
    </Component>
  );
}
