import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "CollabBoard",
  description: "Collaborative whiteboard",
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
