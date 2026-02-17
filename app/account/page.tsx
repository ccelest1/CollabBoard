import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl space-y-4 py-10">
      <h1 className="text-2xl font-semibold text-slate-900">Account</h1>
      <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-700">Signed in as: {user.email}</p>
      </div>
    </div>
  );
}
