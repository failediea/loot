# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Death Mountain is a blockchain-based adventure RPG game built on StarkNet using the Dojo engine. Players battle beasts, collect loot, and progress through challenges. The project has three major components:

1. **Game Client** (`client/`) — React frontend for playing in-browser
2. **Bot Engine** (`bot/src/`) — Automated game-playing bot with modular strategy
3. **SaaS Platform** (`bot/web/`) — Next.js app where users connect Cartridge wallets, delegate session keys, and pay (via on-chain STRK ticket purchase) to have the bot play for them
4. **Smart Contracts** (`contracts/`) — Cairo on-chain game logic on StarkNet mainnet

## Common Development Commands

### Frontend (client/)
```bash
cd client
pnpm install        # Install dependencies
pnpm dev            # Start dev server (port 5173)
pnpm build          # Build for production (tsc -b && vite build)
pnpm lint           # Run ESLint
pnpm preview        # Preview production build
```

### Smart Contracts (contracts/)
```bash
cd contracts
sozo build          # Build Cairo contracts
sozo test           # Run contract tests
scarb fmt           # Format Cairo code (max line length 120)
```

### Bot (bot/)
```bash
cd bot
pnpm install
# Run a new game:
node --import tsx/esm --experimental-wasm-modules src/index.ts --new
# Resume an existing game:
node --import tsx/esm --experimental-wasm-modules src/index.ts --resume <gameId>
# Loop mode (play continuously):
node --import tsx/esm --experimental-wasm-modules src/index.ts --loop
# Run offline simulator:
node --import tsx/esm src/sim/simulate.ts -n 1000
```

### SaaS Platform (bot/web/)
```bash
cd bot/web
pnpm install
# Build (required before first dev run):
NODE_OPTIONS="--experimental-wasm-modules" npx next build
# Dev server (custom server.ts wraps Next.js + WebSocket):
node --require ./polyfill-als.cjs --experimental-wasm-modules --import tsx/esm server.ts
```

## Architecture Overview

### Frontend Architecture (client/)
- **React 18 + TypeScript** using Vite
- **State Management**: Zustand stores in `client/src/stores/`
  - `gameStore.ts` - Game state and player data
  - `marketStore.ts` - Marketplace and trading state
  - `uiStore.ts` - UI settings (persisted to localStorage)
- **Platform-Specific UI**:
  - `client/src/desktop/` - Desktop pages and components
  - `client/src/mobile/` - Mobile pages and components
- **Dojo Integration**: `client/src/dojo/` — blockchain interaction, system calls
- **Generated Code**: `client/src/generated/` — auto-generated Dojo contract bindings
- **Game Data**: `client/src/constants/` — static data (beasts, loot, obstacles)
- **Components**: Reusable UI in `client/src/components/`
- **Combat Simulation**: Web Worker-based Monte Carlo + deterministic DP in `client/src/utils/combatSimulation*.ts`

### Smart Contract Architecture (contracts/)
- **Cairo 2.10.1** contracts with **Dojo v1.6.0** framework
- **Systems** in `contracts/src/systems/`:
  - `adventurer/` - Player character system
  - `beast/` - Enemy and combat system
  - `game/` - Main game loop and state management
  - `game_token/` - Game NFT token management
  - `loot/` - Item generation and management
  - `objectives/` - Game objectives system
  - `settings/` - Game configuration
  - `renderer/` - NFT metadata rendering
- **Models**: `contracts/src/models/` — data structures
- **Libraries**: `contracts/src/libs/` — shared code
- **Network configs**: `contracts/dojo_dev.toml`, `dojo_sepolia.toml`, `dojo_mainnet.toml`, `dojo_slot.toml`

### Bot Architecture (bot/src/)
- **Entry point**: `bot/src/index.ts` — exports `playGame(creds, options)` for SaaS workers + CLI `main()`
- **Chain layer** (`chain/`):
  - `session.ts` — Fetch interceptor for Cartridge session auth + wildcard policy fix
  - `executor.ts` — Transaction execution with retry (paymaster + direct invoke paths)
  - `state.ts` — On-chain game state fetcher (parses `get_game_state` response)
  - `calls.ts` — Call builders for all game actions
  - `swap.ts` — Ekubo DEX integration for STRK → ticket swaps
  - `events.ts` — On-chain event parsing
- **Strategy layer** (`strategy/`):
  - `engine.ts` — Top-level strategy dispatcher
  - `combat.ts` — Monte Carlo combat decisions (fight/flee/gear-swap)
  - `market.ts` — Multi-step priority purchasing (potions → weapons → armor → jewelry)
  - `stats.ts` — Threshold-based stat allocation (DEX+CHA early, VIT mid, WIS late)
  - `gear.ts` — Greatness-weighted gear swapping for beast matchups
  - `combat-sim.ts` — Monte Carlo combat simulation engine
- **Game loop** (`game/`):
  - `loop.ts` — Main loop: poll state → decide → execute → repeat
  - `lifecycle.ts` — Game purchase, ticket swap, start/resume flows
  - `state-machine.ts` — Phase detection (exploring/shopping/battling/leveling)
- **Dashboard** (`dashboard/`):
  - `events.ts` — Typed event emitter (used by both CLI dashboard and SaaS WebSocket)
  - `server.ts` — Standalone HTTP+WS dashboard server for CLI use
- **Simulator** (`sim/simulate.ts`): Offline game simulator with XorShift RNG

### SaaS Platform Architecture (bot/web/)
- **Stack**: Next.js 14 + React 18, Tailwind v4, SQLite (better-sqlite3 + Drizzle ORM), WebSocket (ws)
- **Custom server** (`server.ts`): Wraps Next.js + WebSocket on same port
- **Auth**: Cartridge Controller wallet connection → JWT (jose) via httpOnly cookie
- **Session delegation**: Server generates keypair → user approves via Cartridge Keychain → encrypted private key stored in SQLite (AES-256-GCM)
- **Worker isolation**: `child_process.fork()` per game — each worker gets its own fetch interceptor
- **WebSocket**: Per-game rooms, broadcasts bot events from worker IPC to connected clients
- **DB tables**: users, session_credentials, game_queues, game_requests, game_results
- **Key pages**: Landing (LandingHero) → Idle dashboard (session setup, play controls, history, leaderboard) → Game dashboard (live WebSocket event stream)
- **Payment**: User's own STRK is spent via delegated session key to buy game tickets on-chain (~18 STRK each)

### Key Integration Points
- **Wallet Connection**: Cartridge Controller (client + SaaS)
- **Contract Calls**: Generated Dojo bindings (client), manual call builders (bot)
- **Game State**: Dojo entity-component system (client), direct RPC `get_game_state` (bot)
- **Two execution paths** (bot): Paymaster (free gas, game actions only) and Direct invoke (pays gas in STRK, for DEX swaps)

## Important Configuration

### Environment Variables
- **Client** (`client/.env.production`): `VITE_PUBLIC_VRF_PROVIDER_ADDRESS`, `VITE_PUBLIC_CLOUDFLARE_ID`, `VITE_PUBLIC_ALCHEMY_URL`, `VITE_PUBLIC_POSTHOG_KEY`, `VITE_PUBLIC_POSTHOG_HOST`
- **Bot** (`bot/.env`): `STARKNET_PRIVATE_KEY`, `STARKNET_ACCOUNT_ADDRESS`, `LAVA_RPC_URL`
- **SaaS** (`bot/web/.env.local`): `JWT_SECRET`, `ENCRYPTION_KEY`, `OWNER_ADDRESS`, `MARKUP_PERCENT`, `CARTRIDGE_RPC`

### Key Contracts (Mainnet)
- Game: `0x06f7c4350d6d5ee926b3ac4fa0c9c351055456e75c92227468d84232fc493a9c`
- VRF: `0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f`
- Dungeon: `0x00a67ef20b61a9846e1c82b411175e6ab167ea9f8632bd6c2091823c3629ec42`

## Development Workflow

1. **Frontend**: Work in `client/src/`, run `pnpm dev`
2. **Contracts**: Modify Cairo files in `contracts/src/`, build with `sozo build`, deploy with Dojo CLI
3. **Bot strategy**: Edit `bot/src/strategy/`, test with simulator (`sim/simulate.ts`)
4. **SaaS platform**: Work in `bot/web/src/`, run custom dev server
5. **Bot live test**: Run `--new` or `--resume` against mainnet

## Code Conventions

- TypeScript with partial strict checks (`noImplicitAny`, `strictNullChecks`, `noImplicitThis` — not full `strict: true`)
- React functional components with hooks
- Zustand for client state management
- MUI v7 for client UI components
- Cairo 2.10.1 for smart contracts
- `.tsx` for components, `.ts` for utilities
- Bot logger: structured with levels (debug/info/warn/error) and domain categories (combat/explore/shop/tx/state)

## Gotchas

- **WASM crash**: `@cartridge/controller-wasm` crashes with "url parse" after each tx — bot creates fresh session each turn, swallows the error via `process.on('uncaughtException')`
- **Session auth**: Must use `CARTRIDGE_RPC` (api.cartridge.gg) for session WASM calls, NOT Lava or other RPC providers
- **Wildcard session fix**: Fetch interceptor replaces `sig[2]` with wildcard root, recomputes OE hash, re-signs — see `bot/src/chain/session.ts`
- **Level formula**: `level = xp === 0 ? 1 : floor(sqrt(xp))` — NOT `xp/4+1`
- **Two execution paths**: Paymaster for game actions (free gas), Direct invoke for DEX swaps (pays gas ~0.03 STRK)
- **L2 gas for Ekubo**: Needs 20M (`0x1312D00`), not the default 2M
- **`--experimental-wasm-modules`**: Required flag for any Node.js process using `@cartridge/controller-wasm`
- **bot/web tsconfig**: `src/workers/` is excluded from type checking — uses runtime relative imports to `../../src/`

## Deployment

- **Frontend**: Google App Engine (`client/app.yaml`, Node.js 20 runtime)
- **Contracts**: Dojo CLI with network-specific profiles (`dojo_mainnet.toml`)
- **Bot/SaaS**: Custom Node.js server (no containerization yet)
