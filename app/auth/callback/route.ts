import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const popup = searchParams.get("popup") === "1";

  const popupCompleteHtml = (ok: boolean) => `<!doctype html>
<html>
  <body>
    <script>
      try {
        if (window.opener) {
          window.opener.postMessage({ source: "supabase-oauth", ok: ${ok ? "true" : "false"} }, window.location.origin);
        }
      } catch (e) {}
      window.close();
    </script>
  </body>
</html>`;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (popup) {
        return new Response(popupCompleteHtml(true), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  if (popup) {
    return new Response(popupCompleteHtml(false), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
