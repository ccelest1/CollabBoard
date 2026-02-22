"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "./ThemeToggle";

type AuthUser = {
  email?: string | null;
  user_metadata?: {
    username?: string | null;
  } | null;
};

export function Navbar() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const displayName =
    typeof user?.user_metadata?.username === "string" && user.user_metadata.username.trim().length > 0
      ? user.user_metadata.username.trim()
      : user?.email?.split("@")[0] ?? "User";

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const syncUser = async () => {
      const {
        data: { user: serverUser },
      } = await supabase.auth.getUser();

      if (cancelled) return;
      if (!serverUser) {
        await supabase.auth.signOut();
        if (cancelled) return;
        setUser(null);
        setAuthResolved(true);
        return;
      }

      setUser(serverUser);
      setAuthResolved(true);
    };

    void syncUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setAuthResolved(true);
        return;
      }
      void syncUser();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.replace("/login");
    setSigningOut(false);
  };

  return (
    <nav className="relative z-50 pt-3">
      <div className="container mx-auto px-4">
        <div className="flex h-14 items-center justify-between rounded-xl border border-slate-300 bg-[#eef2f7] px-4 shadow-sm backdrop-blur dark:border-[#444444] dark:bg-[#282928]">
          <Link
            href="/"
            className="flex items-center text-slate-900 hover:text-slate-700 dark:text-white dark:hover:text-slate-200"
          >
            <span
              aria-label="CB"
              className="block text-2xl font-black leading-none tracking-tight text-slate-900 dark:text-white"
            >
              <img
                src="/icons/bend-logo-halftone-arch-light.png"
                alt="BEND"
                className="block dark:hidden"
                style={{
                  height: 36,
                  width: "auto",
                  objectFit: "contain",
                }}
              />
              <img
                src="/icons/bend-logo-halftone-arch-dark.png"
                alt="BEND"
                className="hidden dark:block"
                style={{
                  height: 36,
                  width: "auto",
                  objectFit: "contain",
                }}
              />
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <ThemeToggle />
            {authResolved && user ? (
              <>
                <Link
                  href="/dashboard"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-white dark:border-[#444444] dark:bg-[#282928] dark:text-white dark:hover:bg-[#323332]"
                >
                  Dashboard
                </Link>
                <Link
                  href="/boardverse"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-white dark:border-[#444444] dark:bg-[#282928] dark:text-white dark:hover:bg-[#323332]"
                >
                  BENDverse
                </Link>
                <span className="text-sm text-slate-700 dark:text-white">{`Welcome, ${displayName}`}</span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#d1d5db] dark:bg-[#282928] dark:text-white dark:hover:bg-[#323332]"
                >
                  {signingOut ? "Signing out..." : "Sign out"}
                </button>
              </>
            ) : authResolved ? (
              <Link
                href="/login"
                className="rounded-md border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:border-white dark:bg-black/20 dark:text-white dark:hover:bg-white/10"
              >
                Sign in
              </Link>
            ) : (
              <span className="text-sm text-slate-500 dark:text-white">Loading...</span>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
