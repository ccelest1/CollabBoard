"use client";

import { useEffect } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "collab-theme";

export function ThemeInitializer() {
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme: Theme = stored ?? (systemPrefersDark ? "dark" : "light");
    document.documentElement.classList.toggle("dark", initialTheme === "dark");
  }, []);

  return null;
}
