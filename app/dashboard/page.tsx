import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BoardActions } from "../../components/dashboard/BoardActions";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-2xl items-center justify-center px-4 py-12">
      <div className="w-full rounded-xl border border-slate-300 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Board Dashboard</h1>
        <p className="mt-2 text-sm text-slate-600">Create a board or join one with an existing board id.</p>
        <div className="mt-6">
          <BoardActions />
        </div>
      </div>
    </div>
  );
}
