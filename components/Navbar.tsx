import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./SignOutButton";

export async function Navbar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <Link
          href="/"
          className="text-lg font-semibold text-slate-900 hover:text-slate-700"
        >
          CollabBoard
        </Link>
        <div className="flex items-center gap-4">
          {user ? (
            <>
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
    </nav>
  );
}
