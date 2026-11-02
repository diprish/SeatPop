import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";
import SiteNav from "@/components/site-nav";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "SeatPop — activities for your household",
    template: "%s · SeatPop",
  },
  description:
    "Find the right activity for each person in your household, book it in time.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#161828" },
  ],
};

// Runs before first paint so the stored/system theme applies without a flash.
const THEME_INIT = `(function(){try{var t=localStorage.getItem("seatpop_theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark")}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${jakarta.className} min-h-screen bg-background font-medium text-ink antialiased`}
      >
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-blush-solid/30 blur-3xl" />
          <div className="absolute -right-24 top-10 h-96 w-96 rounded-full bg-sky-solid/30 blur-3xl" />
          <div className="absolute -bottom-32 left-1/3 h-96 w-96 rounded-full bg-lemon-solid/30 blur-3xl" />
        </div>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
