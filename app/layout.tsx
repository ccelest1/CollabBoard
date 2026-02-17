import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { GridBackground } from "@/components/GridBackground";

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
        <GridBackground />
        <Navbar />
        <main className="container mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
