import "./globals.css";
import type { Metadata } from "next";
import AppHeader from "@/components/AppHeader";

export const metadata: Metadata = {
  title: "Flagship — Feature Flags",
  description: "LaunchDarkly-style feature flag & remote config platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <AppHeader />
        <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
