import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BoardWorkspace } from "@/components/board/BoardWorkspace";

type BoardPageProps = {
  params: {
    id: string;
  };
};

export default async function BoardPage({ params }: BoardPageProps) {
  const boardId = params.id;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <BoardWorkspace
      boardId={boardId}
      userId={user.id}
      userLabel={user.email?.split("@")[0] ?? "user"}
    />
  );
}
