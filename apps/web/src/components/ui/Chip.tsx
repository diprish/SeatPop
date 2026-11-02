import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";
import {
  HUE_INK,
  HUE_SOLID_BG,
  HUE_SOLID_BORDER,
  HUE_TINT_BG,
  type Hue,
} from "./hue";

/**
 * Filter chip. Resting: tint bg + 2px solid border + ink text.
 * Selected: solid bg + same-color border + navy text + check.
 */

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  hue: Hue;
  selected?: boolean;
  size?: "md" | "sm";
  showCheck?: boolean;
  children: ReactNode;
}

export function Chip({
  hue,
  selected = false,
  size = "md",
  showCheck = true,
  className = "",
  type = "button",
  children,
  ...rest
}: ChipProps) {
  const tone = selected
    ? `${HUE_SOLID_BG[hue]} ${HUE_SOLID_BORDER[hue]} text-navy`
    : `${HUE_TINT_BG[hue]} ${HUE_SOLID_BORDER[hue]} ${HUE_INK[hue]}`;
  const sizing =
    size === "sm"
      ? "min-h-[44px] px-2.5 text-xs"
      : "min-h-[44px] px-4 text-sm";
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border-2 font-semibold transition-colors duration-200 motion-reduce:transition-none ${sizing} ${tone} ${className}`}
      {...rest}
    >
      {children}
      {selected && showCheck && <Icon name="check" className="h-4 w-4" />}
    </button>
  );
}
