import type { HTMLAttributes, ReactNode } from "react";

/**
 * Surfaces. Default: warm card. Ticket: card shell with the 5px
 * rainbow top strip; pair with TicketDivider for the dashed tear-off
 * with notch circles (aligned to the card's p-4 padding).
 */

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "ticket";
  children: ReactNode;
}

export function Card({
  variant = "default",
  className = "",
  children,
  ...rest
}: CardProps) {
  if (variant === "ticket") {
    return (
      <div
        className={`relative rounded-card border border-line bg-surface p-4 pt-6 shadow-card ${className}`}
        {...rest}
      >
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[5px] rounded-t-card bg-rainbow"
        />
        {children}
      </div>
    );
  }
  return (
    <div
      className={`rounded-card border border-line bg-surface p-4 shadow-card ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function TicketDivider() {
  return (
    <div
      aria-hidden="true"
      className="relative my-3 border-t-2 border-dashed border-line"
    >
      <span className="absolute -left-[27px] -top-[9px] block h-5 w-5 rounded-full border border-line bg-background" />
      <span className="absolute -right-[27px] -top-[9px] block h-5 w-5 rounded-full border border-line bg-background" />
    </div>
  );
}
