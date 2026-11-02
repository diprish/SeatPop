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
  children: ReactNode;
}

export function Chip({
  hue,
  selected = false,
  className = "",
  type = "button",
  children,
  ...rest
}: ChipProps) {
  const tone = selected
    ? `${HUE_SOLID_BG[hue]} ${HUE_SOLID_BORDER[hue]} text-navy`
    : `${HUE_TINT_BG[hue]} ${HUE_SOLID_BORDER[hue]} ${HUE_INK[hue]}`;
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border-2 px-4 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none ${tone} ${className}`}
      {...rest}
    >
      {children}
      {selected && <Icon name="check" className="h-4 w-4" />}
    </button>
  );
}
