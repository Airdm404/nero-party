# Nero Party

A realtime listening party app where friends join a room, build a shared queue, vote on songs, and crown a winner.

## Features

### Core party flow
- Create a party with optional host settings (`maxSongs`, `durationMinutes`)
- Join a party via shareable party code
- Add songs to a shared queue (title, artist, optional YouTube URL)
- Vote/unvote songs in realtime
- Host can set current song, play next, and end party
- End party computes and announces a winning song

### Realtime behavior (Socket.IO)
- Live queue updates across participants
- Live vote count updates
- Live party state updates (current song / ended state)
- Live winner broadcast (`party:ended`)

### Playback
- YouTube embed playback from `externalUrl`
- Host-controlled play/pause state broadcast to all participants
- Lightweight drift correction for better cross-client sync

## Tech Stack

- **Backend:** Express.js, Prisma, Socket.IO
- **Frontend:** React, Vite, TailwindCSS
- **Database:** SQLite (local)
- **Playback source:** YouTube URLs (embed)

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# Install all dependencies
npm install

# Set up environment variables
cp .env.example .env

# Set up and migrate database
cd backend
npx prisma migrate dev
cd ..

# Start frontend + backend in one command
npm run dev
```

This will start:
- Backend on `http://localhost:3000`
- Frontend on `http://localhost:5173`

### Build checks

```bash
cd backend && npm run build
cd ../frontend && npm run build
```

## Project Structure

```
nero-party/
├── backend/          # Express + Socket.IO server
│   ├── prisma/       # Database schema & migrations
│   └── src/          # Server source code
└── frontend/         # React + Vite client
    └── src/          # Client source code
```

## Product / Ranking Decisions

- Voting model: one upvote per user per song (toggle on/off)
- Winner ranking:
  1. Highest vote count
  2. Tie-breaker: earliest queue position
- Host-only permissions:
  - Set current song
  - Playback play/pause
  - End party

## Known Limitations / Scope Choices

- `durationMinutes` is stored but not auto-enforced yet (no timer auto-end)
- Playback sync is best-effort (not frame-perfect across clients)
- Music search API is not integrated; songs are added manually with optional YouTube URL
