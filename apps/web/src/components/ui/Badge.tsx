import type { HTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { HUE_INK, HUE_SOLID_BG, HUE_TINT_BG, type Hue } from "./hue";

/** Small status pill: a pastel tint or solid, the navy pill, or neutral. */

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Hue | "navy" | "neutral";
  solid?: boolean;
  icon?: IconName;
  children: ReactNode;
}

export function Badge({
  tone = "lavender",
  solid = false,
  icon,
  className = "",
  children,
  ...rest
}: BadgeProps) {
  const cls =
    tone === "navy"
      ? "bg-navy text-white"
      : tone === "neutral"
        ? "bg-mist text-ink"
        : solid
          ? `${HUE_SOLID_BG[tone]} text-navy`
          : `${HUE_TINT_BG[tone]} ${HUE_INK[tone]}`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${cls} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}
