import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "BEND",
  description: "Collaborative whiteboard",
  icons: {
    icon: "/icons/bend-browser-icon.png",
    shortcut: "/icons/bend-browser-icon.png",
    apple: "/icons/bend-browser-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="relative min-h-screen overflow-x-hidden antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
