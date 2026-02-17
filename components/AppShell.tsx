"use client";

import { usePathname } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { GridBackground } from "@/components/GridBackground";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isBoardRoute = pathname?.startsWith("/board/");

  if (isBoardRoute) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <>
      <GridBackground />
      <Navbar />
      <main className="container mx-auto px-4 py-6">{children}</main>
    </>
  );
}
