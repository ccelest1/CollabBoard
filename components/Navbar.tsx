"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "./SignOutButton";
import { ThemeToggle } from "./ThemeToggle";

export function Navbar() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

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
            {user ? (
              <>
                <Link
                  href="/dashboard"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Dashboard
                </Link>
                <span className="text-sm text-slate-600">{user.email}</span>
                <SignOutButton />
              </>
            ) : (
              <Link
                href="/login"
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
