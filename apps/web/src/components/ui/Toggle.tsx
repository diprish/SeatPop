/**
 * Switch with a 44px hit area (the visible track stays compact).
 * Pair with a visible label; the accessible name comes from `label`.
 */

export function Toggle({
  checked,
  onChange,
  label,
  className = "",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center ${className}`}
    >
      <span
        aria-hidden="true"
        className={`relative block h-6 w-11 rounded-full transition-colors duration-200 motion-reduce:transition-none ${
          checked ? "bg-navy dark:bg-lavender-solid" : "bg-line"
        }`}
      >
        <span
          className={`absolute top-0.5 block h-5 w-5 rounded-full bg-white shadow transition-all duration-200 motion-reduce:transition-none ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
