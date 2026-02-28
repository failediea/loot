import type { RpcProvider } from "starknet";
import type { BotConfig } from "../config.js";
import type { CallBuilders } from "../chain/calls.js";
import { executeTransaction } from "../chain/executor.js";
import { fetchGameState } from "../chain/state.js";
import { detectPhase, logAdventurerState } from "./state-machine.js";
import { decideNextAction } from "../strategy/engine.js";
import { calculateLevel } from "../utils/math.js";
import { log } from "../utils/logger.js";
import type { GameState, GameSummary } from "../types.js";

const LOOP_DELAY_MS = 2000;
const STATE_FETCH_DELAY_MS = 3000;
const MAX_BACKOFF_MS = 30000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resume playing an existing game.
 * Returns a GameSummary when the adventurer dies, or null if stopped for other reasons.
 */
export async function resumeGame(
  provider: RpcProvider,
  config: BotConfig,
  calls: CallBuilders,
  gameId: number
): Promise<GameSummary | null> {
  log.info(`=== Resuming game ${gameId} ===`);
  return playGameLoop(provider, config, calls, gameId);
}

/**
 * Main game loop - plays until death.
 *
 * Uses session auth via executeFromOutside. Since the WASM crashes after
 * each tx, we don't rely on receipt events for state tracking. Instead,
 * we fetch fresh state from chain each iteration.
 */
async function playGameLoop(
  provider: RpcProvider,
  config: BotConfig,
  calls: CallBuilders,
  gameId: number
): Promise<GameSummary | null> {
  let consecutiveErrors = 0;
  let lastLevel = 0;
  let shoppedThisLevel = false;
  let lastPhase = "unknown";
  let lastAction = "unknown";

  while (true) {
    try {
      // Fetch current state from chain
      log.info(`Fetching game state for game ${gameId}...`);
      const state = await fetchGameState(provider, config, gameId);

      if (!state) {
        log.error("Failed to fetch game state, retrying...");
        await delay(STATE_FETCH_DELAY_MS);
        consecutiveErrors++;
        if (consecutiveErrors > 10) throw new Error("Too many consecutive errors");
        continue;
      }

      const { adventurer } = state;
      logAdventurerState(adventurer);

      // Check if dead
      if (adventurer.health === 0) {
        const deathLevel = calculateLevel(adventurer.xp);
        const causeOfDeath = lastPhase === "in_battle"
          ? `Killed in battle (last action: ${lastAction})`
          : lastPhase === "exploring"
            ? `Died while exploring (obstacle/ambush)`
            : `Died during ${lastPhase}`;
        log.death(`Adventurer died! Level: ${deathLevel}, XP: ${adventurer.xp}, Gold: ${adventurer.gold}`);
        return {
          gameId,
          level: deathLevel,
          xp: adventurer.xp,
          gold: adventurer.gold,
          lastPhase,
          lastAction,
          causeOfDeath,
          stats: { ...adventurer.stats },
        };
      }

      // Track level changes for market reset
      const currentLevel = calculateLevel(adventurer.xp);
      if (currentLevel > lastLevel) {
        shoppedThisLevel = false;
        lastLevel = currentLevel;
      }

      // Detect phase
      const phase = detectPhase(state);
      lastPhase = phase;
      log.info(`Phase: ${phase}`);

      // If detectPhase says "exploring" but market has items and we haven't
      // shopped yet this level, attempt a shopping detour first.
      // Note: detectPhase normally returns "shopping" when market.length > 0,
      // but this guard handles edge cases (e.g. stale state, race conditions).
      if (phase === "exploring" && !shoppedThisLevel && state.market.length > 0) {
        const shopDecision = decideNextAction(gameId, state, "shopping", calls);
        if (shopDecision.calls.length > 0) {
          lastAction = shopDecision.action;
          log.info(`Decision: ${shopDecision.action} - ${shopDecision.reason}`);
          await executeTransaction(null, shopDecision.calls, shopDecision.action, config.rpcUrl, config.chainId);
          shoppedThisLevel = true;
          consecutiveErrors = 0;
          await delay(LOOP_DELAY_MS);
          continue;
        }
        // Nothing worth buying -- mark as shopped so we don't retry every loop
        shoppedThisLevel = true;
      }

      // Get decision for current phase
      const decision = decideNextAction(gameId, state, phase, calls);

      if (decision.calls.length === 0) {
        if (phase === "shopping") {
          // Nothing worth buying; mark as shopped and fall through to explore
          shoppedThisLevel = true;
          log.info("Nothing to buy, skipping market and exploring instead");
          const exploreDecision = decideNextAction(gameId, state, "exploring", calls);
          if (exploreDecision.calls.length > 0) {
            lastAction = exploreDecision.action;
            log.info(`Decision: ${exploreDecision.action} - ${exploreDecision.reason}`);
            await executeTransaction(null, exploreDecision.calls, exploreDecision.action, config.rpcUrl, config.chainId);
            // DO NOT reset shoppedThisLevel here -- we already decided not to
            // buy anything. The flag stays true until a new level is reached.
          }
        }
        consecutiveErrors = 0;
        await delay(LOOP_DELAY_MS);
        continue;
      }

      lastAction = decision.action;
      log.info(`Decision: ${decision.action} - ${decision.reason}`);

      // Execute via session auth
      await executeTransaction(null, decision.calls, decision.action, config.rpcUrl, config.chainId);

      consecutiveErrors = 0;
      await delay(LOOP_DELAY_MS);
    } catch (error: any) {
      consecutiveErrors++;
      const msg = error?.message || String(error);
      log.error(`Error in game loop: ${msg.slice(0, 200)}`);

      // Recoverable contract errors: re-fetch state and retry
      const recoverable = [
        "item already owned", "not enough gold",
      ];
      if (recoverable.some(p => msg.toLowerCase().includes(p.toLowerCase()))) {
        log.warn(`Recoverable error (${msg.slice(0, 80)}), will re-fetch state and retry`);
        await delay(STATE_FETCH_DELAY_MS);
        continue;
      }

      // Don't retry on permanent contract errors
      const permanent = [
        "not owner", "not playable", "game over",
        "game is not in progress", "action not allowed",
        "argent/multicall-failed", "not in battle",
        "already dead", "market closed", "stat points required",
        "inventory full",
      ];
      if (permanent.some(p => msg.toLowerCase().includes(p.toLowerCase()))) {
        log.error("Permanent error - stopping game loop");
        throw error;
      }

      if (consecutiveErrors > 5) {
        log.error("Too many consecutive errors, stopping");
        throw error;
      }

      // Exponential backoff: 2s, 4s, 8s, 16s, capped at 30s
      const backoffMs = Math.min(LOOP_DELAY_MS * Math.pow(2, consecutiveErrors - 1), MAX_BACKOFF_MS);
      log.info(`Retrying in ${backoffMs}ms (attempt ${consecutiveErrors}/5)...`);
      await delay(backoffMs);
    }
  }
}
