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
    <div className="relative left-1/2 w-screen -translate-x-1/2 px-4">
      <div className="mx-auto h-[calc(100vh-7.5rem)] w-full max-w-[1600px] rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-2 text-sm text-slate-600">
          Board ID: <span className="font-medium text-slate-900">{boardId}</span>
        </div>
        <div className="h-[calc(100%-2.25rem)]">
          <BoardWorkspace />
        </div>
      </div>
    </div>
  );
}
