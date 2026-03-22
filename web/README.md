# DyoCraft Dashboard

Real-time web dashboard for monitoring and managing DyoCraft AI bots on a Minecraft server.

## Features

- **Live World Map** — Terrain rendering with block colors, bot/player markers, trails, zoom & pan
- **Bot Management** — Create, delete, and configure AI bots with different personalities and modes
- **Real-time Chat** — Send messages to bots, view conversation threads between bots and players
- **Activity Feed** — Live event log with filtering by bot name and event type
- **Social Graph** — Bot-player relationship matrix with affinity scores
- **Stats & Leaderboards** — Task completion rates, rankings, and per-bot metrics
- **Skill Library** — Browse and inspect learned bot skills with full code viewer
- **Bot Profiles** — Detailed view with inventory, vitals, tasks, relationships, and conversations

## Tech Stack

- **Next.js 16** with App Router
- **React 19** with client-side rendering
- **Tailwind CSS 4**
- **Zustand** for state management
- **Socket.IO** for real-time WebSocket updates
- **Framer Motion** for animations
- **TypeScript**

## Prerequisites

- Node.js 20+
- [mc-server-bot](https://github.com/packetloss404/mc-server-bot) backend running on port 3001

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Backend API server URL |

## Project Structure

```
src/
├── app/                  # Next.js pages
│   ├── activity/         # Event log
│   ├── bots/[name]/      # Bot profile
│   ├── chat/             # Chat threads
│   ├── manage/           # Bot CRUD
│   ├── map/              # World map with terrain
│   ├── skills/           # Skill library
│   ├── social/           # Relationship graph
│   └── stats/            # Leaderboards
├── components/           # Shared components
│   ├── BotCard.tsx       # Bot display card
│   ├── Sidebar.tsx       # Navigation sidebar
│   └── SocketProvider.tsx # WebSocket connection
└── lib/                  # Utilities
    ├── api.ts            # REST API client
    ├── blockColors.ts    # Minecraft block color map
    ├── constants.ts      # Colors, states, config
    ├── socket.ts         # Socket.IO setup
    └── store.ts          # Zustand state store
```

## Compatibility

This dashboard is built specifically for the DyoCraft ecosystem and requires the [mc-server-bot](https://github.com/packetloss404/mc-server-bot) backend. It is **not** a generic Minecraft server panel.

DyoCraft-specific dependencies include:

- **REST + WebSocket API** — Expects DyoCraft's exact endpoint structure (`/api/bots`, `/api/terrain`, `/api/relationships`, `/api/skills`, etc.)
- **Voyager Task System** — Codegen/primitive modes, skill library, and curriculum are DyoCraft concepts
- **Personality System** — Hardcoded bot personalities (merchant, guard, elder, explorer, blacksmith, farmer, builder)
- **Affinity System** — Bot-player relationship scoring with tiered affinity levels
- **Socket Events** — Listens for DyoCraft-specific events (`bot:position`, `bot:health`, `bot:state`, `bot:inventory`, `bot:spawn`, `player:position`, etc.)

To use this with a different Minecraft server, that server would need to implement the same REST and WebSocket API that `mc-server-bot` exposes.

## License

MIT
