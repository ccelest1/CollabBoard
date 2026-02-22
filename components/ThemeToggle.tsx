"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
type ThemeToggleVariant = "default" | "floating";

const STORAGE_KEY = "collab-theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.5V5.2M12 18.8V21.5M21.5 12H18.8M5.2 12H2.5M18.7 5.3L16.8 7.2M7.2 16.8L5.3 18.7M18.7 18.7L16.8 16.8M7.2 7.2L5.3 5.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M14.8 2.9C11 3.2 8 6.3 8 10.2c0 4.1 3.3 7.4 7.4 7.4 2.6 0 4.9-1.3 6.2-3.3-0.9.3-1.9.5-2.9.5-4.5 0-8.1-3.6-8.1-8.1 0-1.4.4-2.6 1-3.8 0.9-0.1 2-0.1 3.2 0z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ThemeToggle({ variant = "default" }: { variant?: ThemeToggleVariant }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme = stored ?? (systemPrefersDark ? "dark" : "light");
    setTheme(initialTheme);
    applyTheme(initialTheme);
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="inline-flex h-9 w-[74px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.12)]" />;
  }

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full bg-white px-[6px] py-1 shadow-[0_1px_4px_rgba(0,0,0,0.12)] ${
        variant === "floating" ? "backdrop-blur-md" : ""
      }`}
      role="group"
      aria-label="Theme toggle"
    >
      <button
        type="button"
        onClick={() => {
          setTheme("light");
          localStorage.setItem(STORAGE_KEY, "light");
          applyTheme("light");
        }}
        className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[#444444] transition-all duration-150 ease-in-out hover:bg-black/[0.10] ${
          theme === "light" ? "opacity-100" : "opacity-[0.35]"
        }`}
        aria-label="Light mode"
      >
        <SunIcon />
      </button>
      <button
        type="button"
        onClick={() => {
          setTheme("dark");
          localStorage.setItem(STORAGE_KEY, "dark");
          applyTheme("dark");
        }}
        className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[#444444] transition-all duration-150 ease-in-out hover:bg-black/[0.10] ${
          theme === "dark" ? "opacity-100" : "opacity-[0.35]"
        }`}
        aria-label="Dark mode"
      >
        <MoonIcon />
      </button>
    </div>
  );
}
