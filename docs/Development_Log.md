# Steps Taken
- Run `npm run costs:update` after dev sessions/hit milestones to update with real numbers from LS
- Killing all local3000
    * `kill -9 $(lsof -t -i:3000)`
- output to .txt file
    * `npm run test:ai 2>&1 | tee ~/Desktop/test-output.txt`

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
4. Installed dependencies
    - `npm install`
5. Copied supabase env vars to `.env.local`
6. Then I had to get Cursor to resolve the supabase connections and pathing
7. Dictated the addition of a user signup form in addition to magiclinks
8. Wanted to fix the layout of the main page
    * Resolve conflicts with React versions
        - `rm -rf node_modules package-lock.json`
9. Getting into design and starting on both (a) infinite board with pan/zoom as well as (b) E2E testing
    (a) board per url: /board/[id] (better for sharing/mulit-room)
    (b) Playwright(next.js, multi tab testing)
10. Following dictation
    * npm install -> npx playwright install -> npm run dev -> npm run test:e2e
11. Able to get boards, but the board is very barebones + getting rate limited so i need to set up SMTP to avoid that service default
    - SMTP using `resend.com`
12. Ignored SMTP for time considerations
13. Now on to core functionality
    - Brought up error regarding the sign in flow (404 when pressing Open Demo Board)
    - Starting on initial grid behavior
14. Working on grid ui + adding sign up/sign in with google additionally
    *
