import { loadConfig } from "./config.js";
import { createProvider } from "./chain/provider.js";
import { createCallBuilders } from "./chain/calls.js";
import { installSessionInterceptor, type SessionCredentials, DEFAULT_CREDENTIALS } from "./chain/session.js";
import { fetchGameState } from "./chain/state.js";
import { resumeGame } from "./game/loop.js";
import { buyGame, startGame } from "./game/lifecycle.js";
import { log } from "./utils/logger.js";
import type { GameSummary } from "./types.js";
import { startDashboard } from "./dashboard/server.js";
import { dashboard } from "./dashboard/events.js";

export interface PlayGameOptions {
  mode: 'new' | 'resume';
  gameId?: number;
  botName?: string;
}

export async function playGame(
  creds: SessionCredentials,
  options: PlayGameOptions,
): Promise<GameSummary | null> {
  installSessionInterceptor(creds);

  const config = loadConfig(creds.controller);
  const provider = createProvider(config);
  const calls = createCallBuilders(config);

  let gameId: number;

  if (options.mode === 'new') {
    gameId = await buyGame(config, calls, provider, options.botName || 'BOT');
    await startGame(config, gameId, calls);
  } else {
    gameId = options.gameId!;
    const state = await fetchGameState(provider, config, gameId);
    if (!state || state.adventurer.health === 0) return null;
  }

  dashboard.emitGameStart(gameId, 1);
  return resumeGame(provider, config, calls, gameId);
}

const DEFAULT_LOOP_DELAY_SECONDS = 5;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logGameSummary(summary: GameSummary, gameNumber: number): void {
  log.info("========================================");
  log.info(`  GAME #${gameNumber} SUMMARY (ID: ${summary.gameId})`);
  log.info("========================================");
  log.info(`  Level:          ${summary.level}`);
  log.info(`  XP:             ${summary.xp}`);
  log.info(`  Gold:           ${summary.gold}`);
  log.info(`  Cause of Death: ${summary.causeOfDeath}`);
  log.info(`  Last Phase:     ${summary.lastPhase}`);
  log.info(`  Last Action:    ${summary.lastAction}`);
  log.info(`  Stats: STR=${summary.stats.strength} DEX=${summary.stats.dexterity} VIT=${summary.stats.vitality} INT=${summary.stats.intelligence} WIS=${summary.stats.wisdom} CHA=${summary.stats.charisma} LCK=${summary.stats.luck}`);
  log.info("========================================");
}

function logCumulativeStats(summaries: GameSummary[]): void {
  if (summaries.length < 2) return;
  const totalXP = summaries.reduce((s, g) => s + g.xp, 0);
  const avgLevel = summaries.reduce((s, g) => s + g.level, 0) / summaries.length;
  const bestLevel = Math.max(...summaries.map((g) => g.level));
  const bestXP = Math.max(...summaries.map((g) => g.xp));
  log.info(`  Cumulative: ${summaries.length} games played, total XP=${totalXP}, avg level=${avgLevel.toFixed(1)}, best level=${bestLevel} (XP=${bestXP})`);
  log.info("========================================");
}

async function main() {
  log.info("Loot Survivor Bot starting (session auth mode)...");

  // Install the session interceptor before anything else
  installSessionInterceptor();

  // Parse CLI args
  const args = process.argv.slice(2);
  let resumeGameId: number | null = null;
  let startNew = false;
  let loopMode = false;
  let botName = "BOT";
  let loopDelay = DEFAULT_LOOP_DELAY_SECONDS;
  let dashboardPort = 8080;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--resume" && args[i + 1]) {
      resumeGameId = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === "--new") {
      startNew = true;
    } else if (args[i] === "--loop") {
      loopMode = true;
      startNew = true; // --loop implies --new
    } else if (args[i] === "--name" && args[i + 1]) {
      botName = args[i + 1];
      i++;
    } else if (args[i] === "--delay" && args[i + 1]) {
      loopDelay = parseInt(args[i + 1]);
      if (isNaN(loopDelay) || loopDelay < 0) loopDelay = DEFAULT_LOOP_DELAY_SECONDS;
      i++;
    } else if (args[i] === "--dashboard-port" && args[i + 1]) {
      dashboardPort = parseInt(args[i + 1]);
      if (isNaN(dashboardPort) || dashboardPort < 1) dashboardPort = 8080;
      i++;
    }
  }

  if (!resumeGameId && !startNew && !loopMode) {
    log.error("Usage:");
    log.error("  Resume: node --import tsx/esm --experimental-wasm-modules src/index.ts --resume <gameId>");
    log.error("  New:    node --import tsx/esm --experimental-wasm-modules src/index.ts --new [--name BOT]");
    log.error("  Loop:   node --import tsx/esm --experimental-wasm-modules src/index.ts --loop [--name BOT] [--delay 5]");
    log.error("");
    log.error("Options:");
    log.error("  --loop           Continuously buy and play games (implies --new)");
    log.error("  --delay <secs>   Delay between games in loop mode (default: 5)");
    log.error("  --name <name>    Adventurer name (default: BOT)");
    process.exit(1);
  }

  // Start dashboard server
  await startDashboard(dashboardPort);

  // Load config
  const config = loadConfig();

  log.info(`RPC: ${config.rpcUrl}`);
  log.info(`Account: ${config.accountAddress.slice(0, 10)}...${config.accountAddress.slice(-6)}`);

  // Initialize chain components
  const provider = createProvider(config);
  const calls = createCallBuilders(config);

  log.success("Chain components initialized");

  if (loopMode) {
    // ---- Continuous loop mode ----
    log.info(`=== LOOP MODE: Playing games continuously (delay: ${loopDelay}s) ===`);
    const summaries: GameSummary[] = [];
    let gameNumber = 0;

    // If --resume was also provided, play that game first before looping
    if (resumeGameId) {
      gameNumber++;
      log.info(`Starting loop with resumed game ${resumeGameId}...`);

      const state = await fetchGameState(provider, config, resumeGameId);
      if (!state) {
        log.error(`Could not fetch state for game ${resumeGameId}`);
        process.exit(1);
      }
      if (state.adventurer.health === 0) {
        log.death(`Game ${resumeGameId} is already dead, skipping to new game`);
      } else {
        log.info(`Game ${resumeGameId}: HP=${state.adventurer.health} XP=${state.adventurer.xp} Gold=${state.adventurer.gold}`);
        dashboard.emitGameStart(resumeGameId, gameNumber);
        const summary = await resumeGame(provider, config, calls, resumeGameId);
        if (summary) {
          summaries.push(summary);
          logGameSummary(summary, gameNumber);
          logCumulativeStats(summaries);
          dashboard.emitGameSummary(summary, gameNumber);
        }
      }
    }

    // Main continuous loop
    while (true) {
      gameNumber++;
      log.info(`\n=== STARTING GAME #${gameNumber} ===`);

      let gameId: number;
      try {
        gameId = await buyGame(config, calls, provider, botName);
        log.success(`Game purchased: ${gameId}`);
        dashboard.emitGameStart(gameId, gameNumber);
      } catch (error: any) {
        const msg = error?.message || String(error);
        if (
          msg.includes("No ticket tokens") ||
          msg.includes("No STRK balance") ||
          msg.includes("buy a game via the web UI")
        ) {
          log.error("========================================");
          log.error("  CANNOT BUY GAME - NO TICKETS");
          log.error("========================================");
          log.error(msg);
          log.error("");
          log.error("To continue, either:");
          log.error("  1. Buy a game through the web UI at https://lootsurvivor.io");
          log.error("  2. Fund the account with STRK tokens for swapping");
          log.error("");
          if (summaries.length > 0) {
            log.info(`Session complete. ${summaries.length} games played.`);
            logCumulativeStats(summaries);
          }
          process.exit(1);
        }
        // For other buy errors, log and retry after delay
        log.error(`Failed to buy game: ${msg.slice(0, 200)}`);
        log.info(`Retrying in ${loopDelay} seconds...`);
        await delay(loopDelay * 1000);
        gameNumber--; // Don't count failed attempts
        continue;
      }

      try {
        await startGame(config, gameId, calls);
        log.success(`Game ${gameId} started!`);
      } catch (error: any) {
        log.error(`Failed to start game ${gameId}: ${error?.message?.slice(0, 200)}`);
        log.info(`Retrying with new game in ${loopDelay} seconds...`);
        await delay(loopDelay * 1000);
        gameNumber--; // Don't count failed attempts
        continue;
      }

      try {
        const summary = await resumeGame(provider, config, calls, gameId);
        if (summary) {
          summaries.push(summary);
          logGameSummary(summary, gameNumber);
          logCumulativeStats(summaries);
          dashboard.emitGameSummary(summary, gameNumber);
        }
      } catch (error: any) {
        log.error(`Game ${gameId} ended with error: ${error?.message?.slice(0, 200)}`);
      }

      log.info(`Waiting ${loopDelay} seconds before next game...`);
      await delay(loopDelay * 1000);
    }
  } else {
    // ---- Single game mode (original behavior) ----
    let gameId: number;

    if (startNew) {
      // Buy and start a new game
      log.info(`Starting new game as "${botName}"...`);
      gameId = await buyGame(config, calls, provider, botName);
      log.success(`Game purchased: ${gameId}`);

      await startGame(config, gameId, calls);
      log.success(`Game ${gameId} started!`);
    } else {
      gameId = resumeGameId!;

      // Check game state before starting
      const state = await fetchGameState(provider, config, gameId);
      if (!state) {
        log.error(`Could not fetch state for game ${gameId}`);
        process.exit(1);
      }
      if (state.adventurer.health === 0) {
        log.death(`Game ${gameId} is already dead`);
        process.exit(0);
      }

      log.info(`Game ${gameId}: HP=${state.adventurer.health} XP=${state.adventurer.xp} Gold=${state.adventurer.gold}`);
    }

    dashboard.emitGameStart(gameId, 1);

    // Play!
    const summary = await resumeGame(provider, config, calls, gameId);
    if (summary) {
      dashboard.emitGameSummary(summary, 1);
    }

    log.info("Bot finished.");
  }
}

main().catch((error) => {
  log.error(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
