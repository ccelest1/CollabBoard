import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BoardWorkspace } from "@/components/board/BoardWorkspace";

export default async function BoardPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const username =
    typeof user.user_metadata?.username === "string" && user.user_metadata.username.trim().length > 0
      ? user.user_metadata.username.trim()
      : null;

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-white">
      <BoardWorkspace boardId={params.id} userLabel={username ?? user.email ?? "User"} />
    </div>
  );
}
