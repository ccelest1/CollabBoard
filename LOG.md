# Steps Taken
1. `npx create-next-app@latest . --typescript --tailwind`
    - initialize npm project with typescript and tailwind
2. `npm install fabric @supabase/supabase-js @supabase/ssr`
    - install fabric.js, supabase, and supabase ssr
3. Set up Next.js 14 with Supabase
    - Supabase client: `lib/supabase/client.ts` (browser), `lib/supabase/server.ts` (server)
    - Auth proxy: `lib/supabase/proxy.ts` + `middleware.ts` for token refresh
    - Layout with navbar: `app/layout.tsx`, `components/Navbar.tsx`
    - Auth page with magic link: `app/login/page.tsx`, `components/MagicLinkForm.tsx`
    - Auth callback: `app/auth/callback/route.ts`
    - Cursor rule: `.cursor/rules/supabase-ssr.mdc`
