import { OwnerBar } from "@/app/components/owner-bar";
import type { Metadata, Viewport } from "next";
import "./globals.css";

// The owner bar reads the session cookie, so every page renders per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Boma Scans",
  description:
    "Real-time Bybit analysis, market scanning, medium-risk trade planning, and live position-management guidance.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Boma Scans",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icons/boma-scans-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080c13",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased"><OwnerBar />{children}</body>
    </html>
  );
}
