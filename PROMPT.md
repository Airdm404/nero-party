# Welcome to Nero Party!

## Here's an Overview

We want you to build Nero party, a **listening party** website where users can:
- Create a listening party and invite friends
- Add songs to a shared queue
- Listen together in real-time
- At the end of the party, a **winning song** is crowned

How the winner is determined is **up to you**. Users must be able to express preference for songs somehow - voting, rating, reactions, rankings, or something else entirely. Design the mechanism and UI however you see fit.

## Requirements

**Must have:**
- Create a party (with configurable conditions like: max song limit, max time limit, or whatever else you think is useful for a host)
- Shareable way to join a party
- Add songs to the queue (integrate with a music API of your choice for search/playback)
- Songs play for all participants
- Real-time updates (queue changes, current song, participants)
- A winning song at the end

**Up to you:**
- How users rate/vote/rank songs
- Whether standings are visible during or revealed at the end
- All UI/UX decisions
- Database schema design
- The rating/ranking algorithm

## Tech Stack

Use the provided starter repo which includes:
- **Backend:** Express.js, Prisma, Socket.IO (basic boilerplate)
- **Frontend:** React, Vite, TailwindCSS (basic boilerplate)
- **Database:** SQLite (local, no setup required)

We recognize that you may not have experience with some or all of these libraries/ frameworks but we're hoping you can get the hang of it quickly. We won't judge too hard on proper implementation of them. 

However, you should know that this **is** our tech stack, so you'll be rewarded if you're able to use them properly.  

Also, you'll need to integrate with a **music API** for song search and playback. Which API you choose is up to you — do some research and pick one that fits well. We intentionally did not implement this for you - we're just making sure you know how to figure stuff out on your own.

## What We're Evaluating

1. **Design & UI/UX** - We care a lot about this. Is it beautiful? Is it intuitive? Does it feel good to use?
2. **Product Thinking** - What did you prioritize? What decisions did you make and why?
3. **Technical Architecture** - Is the code clean? Is the data model sensible? Is the ranking algorithm well-considered?
4. **Creativity** - Surprise us.

## Deliverables

1. **GitHub repo** with your code
2. **Local setup instructions** in the README (we MUST to be able to run it)
3. **3-5 minute video walkthrough** explaining your UI/UX decisions and technical approach (Loom or similar is fine. No need for multiple takes - this doesn't need to be polished)

## Time

- **Deadline:** 48 hours from receipt
- **Expected effort:** ~3 hours
- **AI tools:** Explicitly encouraged. This scope assumes you're using Claude Code, Cursor, Windsurf, or similar.

## Questions?

Reach out if you need clarification on scope, but we won't help with implementation decisions. Figuring things out is part of the exercise.
