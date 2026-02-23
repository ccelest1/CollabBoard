# AI Development Log

## Tools and Workflow
- AI Coding tools used and how they were integrated
    * Claude
    * Cursor

## Effective Prompts
- NO MCPs used

## Code Analysis
- 95% ai code generation vs 5% by hand

## Strengths and Limitations
- Where AI excelled, where it struggled
    * Aiding me in conflicts
    * Boilerplate
    * Asking me stepwise questions and switching contexts when needed
        ```
            I decided to maybe go with a new design for the main page (attached screenshot and I want the css to be around it) and then I want to dive into the features for the actual board/multiplayer

            I also plan on doing testing as well
            End to end testing would be great in order to make sure that all the functions work as described

            the first thing on the list has to be both (a) an infinite board with pan/zoom and then (b) we need cursor sync, we need two cursors to move across browsers, I plan on testing that with two seperate tabs
            I'm assuming they will need to be on different local hosts as I'm just currently deving it out
        ```
    - Cursor switched to Plan for avoiding code churn, etc

- Struggled
    * At the same time it did help me with conflicts, there were a number of times where I just ran into the same errors over and over again
    * Will avoid part of prompt that involves cross-domain work, get's very ft/task locked easily
        * one prompt -> please fix this frontend and then here's our next step for feature dev
            - ignored frontend revision
            - did the other stuff
    * Sometimes performs revisions unnecessarily
        - Can feel like a rollercoaster at points



## Key Learnings
- Insights about working with coding agents
    * You still do need to know what to do in regards to coding context
        - Cursor asks you questions about what to do and your intentions, that you have to answer to proceed
        - Also being experienced here would help when reviewing committed code and conflict resolution
        - You have to be aware of libraries and packages, possible technological conflicts, debt, etc.
        - There are steps that yo`u as a dev have to do such as cli commands
            * Understanding npm, json files, etc
    * Can feel incredibly unsettling, to have building ongoing in so many files at auto
