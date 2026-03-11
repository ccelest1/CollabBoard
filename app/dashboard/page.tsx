import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { readGuestSession } from "@/lib/auth/guestSession";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const guestSession = readGuestSession(cookieStore);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !guestSession) {
    redirect("/login?redirect=/dashboard");
  }

  const effectiveUserId = user?.id ?? guestSession!.guestId;
  return <DashboardClient userId={effectiveUserId} isGuest={!user} />;
}
