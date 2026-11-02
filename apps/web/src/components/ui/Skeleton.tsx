import { HUE_TINT_BG, type Hue } from "./hue";

/** Loading shimmer: pulse only when motion is safe. */

export function Skeleton({
  tone,
  className = "",
}: {
  tone?: Hue;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-xl motion-reduce:animate-none ${tone ? HUE_TINT_BG[tone] : "bg-mist"} ${className}`}
    />
  );
}
