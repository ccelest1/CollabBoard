"use client";

import { usePathname } from "next/navigation";
import { GridBackground } from "@/components/GridBackground";
import { Navbar } from "@/components/Navbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isBoardRoute = pathname?.startsWith("/board/");
  const isHomeRoute = pathname === "/";
  const backgroundMode = pathname === "/" ? "home" : pathname?.startsWith("/dashboard") ? "dashboard" : "default";

  if (isBoardRoute || isHomeRoute) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <>
      <GridBackground mode={backgroundMode} />
      <Navbar />
      <main className="container mx-auto px-4 py-6">{children}</main>
    </>
  );
}
