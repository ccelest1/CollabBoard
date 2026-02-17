"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "./ThemeToggle";

type AuthUser = {
  email?: string | null;
};

export function Navbar() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setAuthResolved(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthResolved(true);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
    setSigningOut(false);
  };

  return (
    <nav className="pt-3">
      <div className="container mx-auto px-4">
        <div className="flex h-14 items-center justify-between rounded-xl border border-slate-300 bg-white/95 px-4 shadow-sm backdrop-blur">
          <Link
            href="/"
            className="text-lg font-semibold text-slate-900 hover:text-slate-700"
          >
            CollabBoard
          </Link>

          <div className="flex items-center gap-4">
            <ThemeToggle />
            {authResolved && user ? (
              <>
                <Link
                  href="/dashboard"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Dashboard
                </Link>
                <span className="text-sm text-slate-600">{user.email}</span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {signingOut ? "Signing out..." : "Sign out"}
                </button>
              </>
            ) : authResolved ? (
              <Link
                href="/"
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Sign in
              </Link>
            ) : (
              <span className="text-sm text-slate-500">Loading...</span>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
