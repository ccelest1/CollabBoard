import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-5xl flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">Welcome to CollabBoard</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-200">Real-time collaboration in the AI-age.</p>
      </div>

      <div className="mt-7 w-full max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-sm">
        <p className="text-center text-slate-700">Sign in to create/join a collaborative board.</p>
        <Link
          href="/login"
          className="mt-4 inline-block w-full rounded-md bg-slate-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-slate-800"
        >
          Go to Login
        </Link>
      </div>
    </div>
  );
}
