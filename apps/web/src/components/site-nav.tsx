"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY } from "@/lib/household";
import { Icon, type IconName } from "./ui/Icon";

const LINKS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "For you", icon: "users" },
  { href: "/explore", label: "Explore", icon: "search" },
  { href: "/saved", label: "Saved", icon: "heart" },
  { href: "/booked", label: "Booked", icon: "ticket" },
  { href: "/trust", label: "Trust", icon: "shield" },
];

function isActiveLink(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Wordmark() {
  return (
    <Link href="/" className="flex min-h-[44px] items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy text-white dark:bg-lavender-solid dark:text-navy">
        <Icon name="ticket" className="h-5 w-5" />
      </span>
      <span className="text-lg font-extrabold tracking-tight">SeatPop</span>
    </Link>
  );
}

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="min-touch rounded-full border-2 border-line px-2 text-sm"
    >
      {dark ? "☀" : "☾"}
    </button>
  );
}

export default function SiteNav() {
  const pathname = usePathname();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme(): void {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Private mode: theme still applies for the session.
    }
    setDark(next);
  }

  return (
    <>
      <header className="sticky top-0 z-40 hidden border-b border-line bg-surface/80 backdrop-blur lg:block">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Wordmark />
          <nav aria-label="Primary" className="flex flex-1 gap-1 text-sm">
            {LINKS.map((link) => {
              const active = isActiveLink(link.href, pathname);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "inline-flex min-h-[44px] items-center rounded-full bg-primary px-4 font-bold text-white dark:text-navy"
                      : "inline-flex min-h-[44px] items-center rounded-full px-4 text-muted hover:bg-lavender-tint hover:text-ink"
                  }
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <ThemeToggle dark={dark} onToggle={toggleTheme} />
        </div>
        <div aria-hidden="true" className="h-1 bg-rainbow" />
      </header>

      <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2">
          <Wordmark />
          <ThemeToggle dark={dark} onToggle={toggleTheme} />
        </div>
        <div aria-hidden="true" className="h-1 bg-rainbow" />
      </header>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <div className="grid grid-cols-5">
          {LINKS.map((link) => {
            const active = isActiveLink(link.href, pathname);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 py-2 text-[11px] ${
                  active ? "font-bold text-ink" : "text-faint"
                }`}
              >
                <span
                  className={
                    active
                      ? "rounded-full bg-primary px-4 py-1 text-white dark:text-navy"
                      : ""
                  }
                >
                  <Icon name={link.icon} className="h-5 w-5" />
                </span>
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
