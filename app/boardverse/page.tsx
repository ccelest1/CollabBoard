import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BendverseClient from "@/app/bendverse/BendverseClient";

export const dynamic = "force-dynamic";

export default async function BoardversePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/boardverse");
  }

  const userName =
    typeof user.user_metadata?.username === "string" && user.user_metadata.username.trim().length > 0
      ? user.user_metadata.username.trim()
      : user.email ?? "User";

  return <BendverseClient currentUserId={user.id} userName={userName} />;
}
