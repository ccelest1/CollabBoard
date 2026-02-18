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
- Infinite Board with pan/zoom [x]
- Sticky Notes with editable text []
    * Create, edit text (text must reformat based on note size changes)
- Add to bottom taskbar a color changer -> can choose color options when selecting an item (any board object put down (sticky, rectangle, circle, line, text) [x]
- One shape type (rectangle, circle, or line) []
    - Rectangle, circle
    - For line
        * When user presses (clicks) line,
        * (1) modal pops out from line to choose between arrow and line, then they choose
        * (2) dialogue box pops up informing them that if they press on a rectangle, circle, or existing line that the next place they click will have a connector (line or arrow between the two points)
- Able to type text [ ]
    * add a text button to bottom horizontal bar allowing for standalone text elements
    * able to resize text
- Frames
    * group and organize content areas
- Transforms [x]
    * able to move, resize, and rotate objects
        * move is with the cursor selected only
        * resize is done at the margins and corners
        * Provide a rotation option that is that left corner of items that if they click allows for object rotation
- Selection [x]
    * users are able to select with cursor and not hand, multi select via dragging the cursor to choose multiple items
    * shift click allows for the user to have items aligned on diagonal, vertical, and horizontal axes
- Operations [x]
    * Users can delete via click selection and pressing delete
    * When users press on an item given them the modal option of duplicating
    * Users can copy and paste via command c, command x

## Multiplayer
- Real-time sync between 2+ USERS [ ]
- Multiplayer cursors with name labels [ ]
    * creation and modification of objects appears for all users instantly [ ]
- Presence awareness (who's online) [ ]
    * Each user has a unique color and it shows their username+color to other users [ ]
- Conflicts
    * For simultaneous edits, show changes but ;last write wins [ ]
- Resilience
    * We need to handle disconnection and reconnection gracefully [ ]
        - If users disconnect, show a red wifi crossed out indicator below the toolbar, pop up that tells the user they are disconnected [ ]
        - if user reconnects, then update to current board state and make indicator and popup dissapear [ ]
- Persistence
    * Board needs to survive all users leaving and returning [ ]
        - Board state persists all changes made by other users and saves it for next time a user goes to board
- User authentication [x] - need to fix full pathing
- Deployed and public accessible

## Performance Targets
- Frame Rate
    * 60 fps during manipulation (pan, zoom, object)
- Object Sync Latency
    * < 100 ms
- Cursor Sync Latency
    * < 50 ms
- Object Capacity
    * 500+ objects w/o performance drops
- Concurrent users
    * 5+ w/o degradation

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
