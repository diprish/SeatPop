/** Loading shimmer: pulse only when motion is safe. */

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-xl bg-mist motion-reduce:animate-none ${className}`}
    />
  );
}
