import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BoardWorkspaceV2 } from "@/components/board/BoardWorkspaceV2";
import { readGuestSession } from "@/lib/auth/guestSession";

export const dynamic = "force-dynamic";

export default async function BoardPage({ params }: { params: { id: string } }) {
  const cookieStore = await cookies();
  const guestSession = readGuestSession(cookieStore);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // ignored in server component context
        }
      },
    },
  });
  const cleanBoardId = String(params.id ?? "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !guestSession) {
    redirect(`/login?redirect=${encodeURIComponent(`/board/${cleanBoardId}`)}`);
  }

  const username = user
    ? typeof user.user_metadata?.username === "string" && user.user_metadata.username.trim().length > 0
      ? user.user_metadata.username.trim()
      : null
    : guestSession?.guestName ?? null;
  const effectiveUserId = user?.id ?? guestSession!.guestId;
  const isGuest = !user;

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-white">
      <BoardWorkspaceV2
        boardId={cleanBoardId}
        userLabel={username ?? user?.email ?? "User"}
        userId={effectiveUserId}
        isGuest={isGuest}
      />
    </div>
  );
}
