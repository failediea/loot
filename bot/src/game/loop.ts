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
import { dashboard } from "../dashboard/events.js";

const LOOP_DELAY_MS = 500;
const STATE_POLL_INTERVAL_MS = 1500;
const STATE_POLL_MAX_ATTEMPTS = 5; // 5 * 1.5s = 7.5s max wait
const MAX_BACKOFF_MS = 30000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fingerprint key state fields. If any change after a TX, state is fresh. */
function stateFingerprint(state: GameState): string {
  const a = state.adventurer;
  return `${a.health}:${a.xp}:${a.gold}:${a.beast_health}:${a.stat_upgrades_available}:${a.action_count}`;
}

/**
 * Poll state until it differs from preFp (pre-TX fingerprint).
 * Returns fresh state, or last-read state if max attempts exceeded.
 */
async function waitForFreshState(
  provider: RpcProvider,
  config: BotConfig,
  gameId: number,
  preFp: string
): Promise<GameState | null> {
  for (let i = 0; i < STATE_POLL_MAX_ATTEMPTS; i++) {
    await delay(STATE_POLL_INTERVAL_MS);
    const state = await fetchGameState(provider, config, gameId);
    if (!state) continue;
    const fp = stateFingerprint(state);
    if (fp !== preFp) {
      if (i > 0) log.info(`Fresh state after ${i + 1} polls (${(i + 1) * STATE_POLL_INTERVAL_MS}ms)`);
      return state;
    }
  }
  log.warn(`State still stale after ${STATE_POLL_MAX_ATTEMPTS} polls, proceeding anyway`);
  // Return whatever we got last
  return fetchGameState(provider, config, gameId);
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
  let currentState: GameState | null = null;

  while (true) {
    try {
      // Fetch current state from chain (or use fresh state from post-TX poll)
      if (!currentState) {
        log.info(`Fetching game state for game ${gameId}...`);
        currentState = await fetchGameState(provider, config, gameId);
      }
      const state = currentState;
      currentState = null; // Consume it — will re-fetch next iteration unless set by post-TX poll

      if (!state) {
        log.error("Failed to fetch game state, retrying...");
        await delay(STATE_POLL_INTERVAL_MS);
        consecutiveErrors++;
        if (consecutiveErrors > 10) throw new Error("Too many consecutive errors");
        continue;
      }

      const { adventurer } = state;
      logAdventurerState(adventurer);

      // Check if dead
      if (adventurer.health === 0) {
        const deathLevel = calculateLevel(adventurer.xp);
        const causeOfDeath = lastPhase === "in_battle" || lastPhase === "starter_beast"
          ? `Killed in battle (last action: ${lastAction})`
          : lastPhase === "exploring"
            ? `Died while exploring (obstacle/ambush)`
            : `Died (HP reached 0 after ${lastAction || lastPhase})`;
        log.death(`Adventurer died! Level: ${deathLevel}, XP: ${adventurer.xp}, Gold: ${adventurer.gold}`);
        dashboard.emitStateUpdate(gameId, state, "dead");
        const summary: GameSummary = {
          gameId,
          level: deathLevel,
          xp: adventurer.xp,
          gold: adventurer.gold,
          lastPhase,
          lastAction,
          causeOfDeath,
          stats: { ...adventurer.stats },
        };
        dashboard.emitGameSummary(summary);
        return summary;
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
      dashboard.emitStateUpdate(gameId, state, phase);

      // Pre-TX fingerprint for stale detection
      const preFp = stateFingerprint(state);

      // If detectPhase says "exploring" but market has items and we haven't
      // shopped yet this level, attempt a shopping detour first.
      if (phase === "exploring" && !shoppedThisLevel && state.market.length > 0) {
        const shopDecision = decideNextAction(gameId, state, "shopping", calls);
        if (shopDecision.calls.length > 0) {
          lastAction = shopDecision.action;
          log.info(`Decision: ${shopDecision.action} - ${shopDecision.reason}`);
          dashboard.emitDecision("shopping", shopDecision.action, shopDecision.reason);
          await executeTransaction(null, shopDecision.calls, shopDecision.action, config.rpcUrl, config.chainId);
          shoppedThisLevel = true;
          consecutiveErrors = 0;
          currentState = await waitForFreshState(provider, config, gameId, preFp);
          continue;
        }
        shoppedThisLevel = true;
      }

      // Get decision for current phase
      const decision = decideNextAction(gameId, state, phase, calls);

      if (decision.calls.length === 0) {
        if (phase === "shopping") {
          shoppedThisLevel = true;
          log.info("Nothing to buy, skipping market and exploring instead");
          const exploreDecision = decideNextAction(gameId, state, "exploring", calls);
          if (exploreDecision.calls.length > 0) {
            lastAction = exploreDecision.action;
            log.info(`Decision: ${exploreDecision.action} - ${exploreDecision.reason}`);
            dashboard.emitDecision("exploring", exploreDecision.action, exploreDecision.reason);
            await executeTransaction(null, exploreDecision.calls, exploreDecision.action, config.rpcUrl, config.chainId);
            consecutiveErrors = 0;
            currentState = await waitForFreshState(provider, config, gameId, preFp);
            continue;
          }
        }
        consecutiveErrors = 0;
        await delay(LOOP_DELAY_MS);
        continue;
      }

      lastAction = decision.action;
      log.info(`Decision: ${decision.action} - ${decision.reason}`);
      dashboard.emitDecision(phase, decision.action, decision.reason);

      // Execute via session auth
      await executeTransaction(null, decision.calls, decision.action, config.rpcUrl, config.chainId);

      consecutiveErrors = 0;
      // Wait for RPC to reflect the TX before next iteration
      currentState = await waitForFreshState(provider, config, gameId, preFp);
    } catch (error: any) {
      consecutiveErrors++;
      const msg = error?.message || String(error);
      log.error(`Error in game loop: ${msg.slice(0, 200)}`);

      // argent/multicall-failed wraps inner contract errors. Only treat it
      // as permanent if the inner error is truly unrecoverable. Most inner
      // errors are caused by stale RPC reads and resolve after a re-fetch.
      const msgLower = msg.toLowerCase();

      // Truly permanent errors — game is over, wrong owner, etc.
      const hardPermanent = [
        "not owner", "not playable", "game over",
        "game is not in progress", "already dead",
      ];
      if (hardPermanent.some(p => msgLower.includes(p))) {
        log.error("Permanent error - stopping game loop");
        throw error;
      }

      // Stale-state errors — these happen when the RPC returns old state
      // after a TX. Re-fetch state and the next iteration will decide correctly.
      const staleStateErrors = [
        "item already owned", "not enough gold",
        "health already full", "stat upgrade available",
        "market is closed", "market closed",
        "not in battle", "action not allowed",
        "stat points required", "inventory full",
        "argent/multicall-failed",
        "transaction reverted",
      ];
      if (staleStateErrors.some(p => msgLower.includes(p))) {
        log.warn(`Likely stale state (${msg.slice(0, 120)}), re-fetching and retrying`);
        currentState = null; // Force fresh fetch
        await delay(STATE_POLL_INTERVAL_MS * 2);
        continue;
      }

      if (consecutiveErrors > 5) {
        log.error("Too many consecutive errors, stopping");
        throw error;
      }

      // Exponential backoff
      const backoffMs = Math.min(LOOP_DELAY_MS * Math.pow(2, consecutiveErrors - 1), MAX_BACKOFF_MS);
      log.info(`Retrying in ${backoffMs}ms (attempt ${consecutiveErrors}/5)...`);
      await delay(backoffMs);
    }
  }
}
