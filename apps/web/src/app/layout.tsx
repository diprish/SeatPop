import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import SiteNav from "@/components/site-nav";
import "./globals.css";

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
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1917" },
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
      <body className="min-h-screen bg-background font-sans text-ink antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
