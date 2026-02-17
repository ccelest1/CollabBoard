import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BoardActions } from "@/components/dashboard/BoardActions";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-5xl flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-3xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Board Dashboard
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-200">
          Create a new board or join one shared by your teammate.
        </p>
      </div>

      <BoardActions />
    </div>
  );
}
