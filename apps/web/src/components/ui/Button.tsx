import type { ButtonHTMLAttributes, ReactNode } from "react";
import { HUE_INK, HUE_SOLID_BORDER, HUE_TINT_BG, type Hue } from "./hue";

/**
 * Actions. Primary: navy bg, white text (flips to lavender solid
 * with navy text in dark mode via the primary token). Secondary: a
 * pastel tint. Ghost: an inline link look.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  hue?: Hue;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  hue = "lavender",
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const tone =
    variant === "primary"
      ? "bg-primary px-5 text-white dark:text-navy"
      : variant === "secondary"
        ? `${HUE_TINT_BG[hue]} border-2 px-5 ${HUE_SOLID_BORDER[hue]} ${HUE_INK[hue]}`
        : "px-2 text-ink underline-offset-4 hover:underline";
  return (
    <button
      type={type}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full text-sm font-bold transition-colors duration-200 motion-reduce:transition-none disabled:opacity-40 ${tone} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
