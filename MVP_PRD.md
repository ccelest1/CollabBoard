# CollabBoard

## Tech Stack
- Frontend
    * Next.js 14, Tailwind, Fabric.js (canvas library)
        * Fabric.js
            - Handles canvas library for pzn/zoom/objects ut of box
- Backend
    * Next.js API Routes, Supabase (auth, realtime)
        * Supabase Realtime
            - Web socket layer
        * Next.js
            - No separate BE deployment for routes
- Deployment
    * Vercel
        - Deploy via `vercel --prod`


## MVP Requirements
- Infinite Board with pan/zoom
- Sticky Notes with editable text
- One shape type (rectangle, circle, or line)
- Create, move, edit objects
- Real-time sync between 2+ USERS
- Multiplayer cursors with name labels
- Presence awareness (who's online)
- User authentication
- Deployed and public accessible

### Build Strategy
1. Cursor sync — Get two cursors moving across browsers []
2. Object sync — Create sticky notes that appear for all users []
3. Conflict handling — Handle simultaneous edits []
4. State persistence — Survive refreshes and reconnects []
5. Board features — Shapes, frames, connectors, transforms []
6. AI commands (basic) — Single-step creation/manipulation []
7. AI commands (complex) — Multi-step template generation []

### Critical Guidance
• Multiplayer sync is the hardest part. Start here.
• Build vertically: finish one layer before starting the next
• Test with multiple browser windows continuously []
• Throttle network speed during testing []
• Test simultaneous AI commands from multiple users []

### Testing Scenarios
1. Test 2 users editing in different browsers []
2. One user refresh mid-edit (state persistence) []
3. Rapid creation, sticky note and shape movement (sync performance) []
4. Network throttling, disconnect recovery []
5. 5+ concurrent users w/o degredation []


##
