import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readGuestSession } from "@/lib/auth/guestSession";

function safeRedirectPath(candidate: string | null | undefined, fallback: string) {
  if (!candidate) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//")) return fallback;
  return candidate;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const pathname = request.nextUrl.pathname;
  const isProtectedRoute = pathname.startsWith("/dashboard") || pathname.startsWith("/board");
  const guestSession = readGuestSession(request.cookies);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !guestSession && isProtectedRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const intended = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    url.searchParams.set("redirect", safeRedirectPath(intended, "/dashboard"));
    return NextResponse.redirect(url);
  }

  if ((user || guestSession) && pathname === "/login") {
    const redirectTarget = safeRedirectPath(request.nextUrl.searchParams.get("redirect"), "/dashboard");
    return NextResponse.redirect(new URL(redirectTarget, request.url));
  }

  return supabaseResponse;
}
