import type { InputHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";

/** Labeled 44px input with an icon prefix and hint/error slots. */

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  icon: IconName;
  hint?: string;
  error?: string;
}

export function Field({
  id,
  label,
  icon,
  hint,
  error,
  className = "",
  ...rest
}: FieldProps) {
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter((part) => part !== null)
      .join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="relative mt-1">
        <Icon
          name={icon}
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
        />
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`min-h-[44px] w-full rounded-xl border border-line bg-surface pl-10 pr-3 text-sm text-ink placeholder:text-faint ${className}`}
          {...rest}
        />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-faint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-semibold text-blush-ink">
          {error}
        </p>
      )}
    </div>
  );
}
