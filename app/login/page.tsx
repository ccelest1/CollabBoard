import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthForm } from "@/components/AuthForm";

function safeRedirectPath(candidate: string | null | undefined, fallback: string) {
  if (!candidate) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//")) return fallback;
  return candidate;
}

export default async function LoginPage({ searchParams }: { searchParams?: { redirect?: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(safeRedirectPath(searchParams?.redirect, "/dashboard"));
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-5xl flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl text-center">
        <h1 className="flex items-center justify-center text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
          <span aria-label="CB" className="block text-7xl font-black leading-none tracking-tight text-slate-900 dark:text-white">
            <img
              src="/icons/bend-logo-halftone-arch-light.png"
              alt="BEND"
              className="mx-auto block dark:hidden"
              style={{
                height: 90,
                width: "auto",
                objectFit: "contain",
              }}
            />
            <img
              src="/icons/bend-logo-halftone-arch-dark.png"
              alt="BEND"
              className="mx-auto hidden dark:block"
              style={{
                height: 90,
                width: "auto",
                objectFit: "contain",
              }}
            />
          </span>
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-200">
          Real-time collaboration at the speed of thought.
        </p>
      </div>

      <div className="mt-7 w-full max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-sm">
        <AuthForm />
      </div>
    </div>
  );
}
